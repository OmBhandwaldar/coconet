import mongoose from 'mongoose';
import { logger } from '../config/logger.js';
import { BridgeStore, ClaimResult, DeadLetterRecord, InboxEntry } from './store.js';

// ─── Mongo-backed BridgeStore ─────────────────────────────────────────────────
// Raw collections rather than mongoose models: this is infrastructure state, not
// one of the eight BRD data models (CLAUDE.md §9), and the operations that matter
// here are atomic upserts whose exact shape a schema layer would obscure.
//
// Atomicity is the whole correctness argument. Every claim and every lease
// acquisition is ONE findOneAndUpdate with a filter that only matches when the
// caller is entitled to win. Read-then-write would let two workers both observe
// "unclaimed" and both proceed — which is the double-release this store exists
// to prevent, reintroduced in the code meant to prevent it.

const INBOX = 'bridge_inbox';
const CHECKPOINTS = 'bridge_checkpoints';
const DEAD_LETTERS = 'bridge_dead_letters';
const LEASES = 'bridge_leases';

// Every collection keys on a string _id — the event key, the stream name, the
// lease name. Typing that explicitly matters: the driver defaults _id to
// ObjectId, and an untyped collection() silently accepts a filter that can
// never match.
interface InboxDoc {
  _id: string;
  stream: string;
  status: InboxEntry['status'];
  attempts: number;
  updated_at: Date;
  error?: string;
  payload?: Record<string, unknown>;
}

interface CheckpointDoc {
  _id: string;
  position: string;
  updated_at: Date;
}

interface DeadLetterDoc {
  _id: string;
  key: string;
  stream: string;
  error: string;
  attempts: number;
  payload?: Record<string, unknown> | null;
  failed_at: Date;
}

interface LeaseDoc {
  _id: string;
  owner: string;
  expires_at: Date;
  renewed_at: Date;
}

export class MongoBridgeStore implements BridgeStore {
  private constructor(private readonly db: mongoose.mongo.Db) {}

  static async connect(uri: string): Promise<MongoBridgeStore> {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5_000 });
    const db = mongoose.connection.db;
    if (!db) throw new Error('Mongo connected but exposed no database handle');
    const store = new MongoBridgeStore(db);
    await store.ensureIndexes();
    logger.info({ db: db.databaseName }, 'Bridge store connected (MongoDB)');
    return store;
  }

  private async ensureIndexes(): Promise<void> {
    // _id carries the event key, so uniqueness is enforced by Mongo itself and
    // a duplicate insert cannot race past it.
    await this.db.collection(INBOX).createIndex({ stream: 1, status: 1, updated_at: 1 });
    await this.db.collection<DeadLetterDoc>(DEAD_LETTERS).createIndex({ failed_at: -1 });
  }

  async claimEvent(key: string, stream: string, staleAfterMs: number): Promise<ClaimResult> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - staleAfterMs);
    const col = this.db.collection<InboxDoc>(INBOX);

    // One round trip, one filter. It matches only when this caller may take the
    // event: nobody has it, a previous attempt failed, or the holder is stale.
    const taken = await col.findOneAndUpdate(
      {
        _id: key,
        $or: [
          { status: 'failed' },
          { status: 'processing', updated_at: { $lt: staleBefore } },
        ],
      },
      { $set: { status: 'processing', updated_at: now }, $inc: { attempts: 1 } },
      { returnDocument: 'after' },
    );
    if (taken) return 'retry';

    try {
      await col.insertOne({ _id: key, stream, status: 'processing', attempts: 1, updated_at: now });
      return 'new';
    } catch (err) {
      // Duplicate _id: either already done, or another worker just claimed it.
      // Both mean "not mine", which is what the caller needs to know.
      if ((err as { code?: number }).code === 11000) return 'duplicate';
      throw err;
    }
  }

  async completeEvent(key: string): Promise<void> {
    await this.db.collection<InboxDoc>(INBOX).updateOne(
      { _id: key },
      { $set: { status: 'done', updated_at: new Date() }, $unset: { error: '' } },
    );
  }

  async failEvent(
    key: string, error: string, maxAttempts: number, payload?: Record<string, unknown>,
  ): Promise<{ attempts: number; dead: boolean }> {
    const col = this.db.collection<InboxDoc>(INBOX);
    const entry = await col.findOne({ _id: key });
    if (!entry) return { attempts: 0, dead: false };

    const dead = entry.attempts >= maxAttempts;
    await col.updateOne(
      { _id: key },
      {
        $set: {
          status: dead ? 'dead' : 'failed', error, updated_at: new Date(),
          ...(payload ? { payload } : {}),
        },
      },
    );
    if (dead) {
      await this.db.collection<DeadLetterDoc>(DEAD_LETTERS).updateOne(
        { _id: key },
        {
          $set: {
            key, stream: entry.stream, error, attempts: entry.attempts,
            payload: payload ?? null, failed_at: new Date(),
          },
        },
        { upsert: true },
      );
      logger.error({ key, attempts: entry.attempts, error }, 'Bridge: dead-lettered after exhausting retries');
    }
    return { attempts: entry.attempts, dead };
  }

  async getEntry(key: string): Promise<InboxEntry | null> {
    const d = await this.db.collection<InboxDoc>(INBOX).findOne({ _id: key });
    if (!d) return null;
    return {
      key: d._id, stream: d.stream, status: d.status, attempts: d.attempts,
      updated_at: d.updated_at.toISOString(), error: d.error, payload: d.payload,
    };
  }

  async dueForRetry(stream: string, limit: number): Promise<InboxEntry[]> {
    const docs = await this.db.collection<InboxDoc>(INBOX)
      .find({ stream, status: 'failed' })
      .sort({ updated_at: 1 })
      .limit(limit)
      .toArray();
    return docs.map((d) => ({
      key: d._id, stream: d.stream, status: d.status, attempts: d.attempts,
      updated_at: d.updated_at.toISOString(), error: d.error, payload: d.payload,
    }));
  }

  async checkpoint(stream: string): Promise<string | null> {
    const d = await this.db.collection<CheckpointDoc>(CHECKPOINTS).findOne({ _id: stream });
    return d?.position ?? null;
  }

  async setCheckpoint(stream: string, position: string): Promise<void> {
    await this.db.collection<CheckpointDoc>(CHECKPOINTS).updateOne(
      { _id: stream },
      { $set: { position, updated_at: new Date() } },
      { upsert: true },
    );
  }

  async listDeadLetters(limit: number): Promise<DeadLetterRecord[]> {
    const docs = await this.db.collection<DeadLetterDoc>(DEAD_LETTERS)
      .find({}).sort({ failed_at: -1 }).limit(limit).toArray();
    return docs.map((d) => ({
      id: d._id, key: d.key, stream: d.stream, error: d.error, attempts: d.attempts,
      payload: d.payload ?? undefined,
      failed_at: d.failed_at.toISOString(),
    }));
  }

  async reopenDeadLetter(key: string): Promise<boolean> {
    const removed = await this.db.collection<DeadLetterDoc>(DEAD_LETTERS).deleteOne({ _id: key });
    if (removed.deletedCount === 0) return false;
    await this.db.collection<InboxDoc>(INBOX).updateOne(
      { _id: key },
      { $set: { status: 'failed', attempts: 0, updated_at: new Date() } },
    );
    logger.info({ key }, 'Bridge: dead letter reopened for retry');
    return true;
  }

  async acquireLease(name: string, owner: string, ttlMs: number): Promise<boolean> {
    const now = new Date();
    const expires = new Date(now.getTime() + ttlMs);
    try {
      // Wins only if unheld, already ours, or expired — in a single operation,
      // so two starting replicas cannot both become leader.
      const res = await this.db.collection<LeaseDoc>(LEASES).findOneAndUpdate(
        { _id: name, $or: [{ owner }, { expires_at: { $lt: now } }] },
        { $set: { owner, expires_at: expires, renewed_at: now } },
        { upsert: true, returnDocument: 'after' },
      );
      return res?.owner === owner;
    } catch (err) {
      // Upsert lost the race to create the document: someone else is leader.
      if ((err as { code?: number }).code === 11000) return false;
      throw err;
    }
  }

  async releaseLease(name: string, owner: string): Promise<void> {
    await this.db.collection<LeaseDoc>(LEASES).deleteOne({ _id: name, owner });
  }

  async leaseOwner(name: string): Promise<string | null> {
    const d = await this.db.collection<LeaseDoc>(LEASES).findOne({ _id: name });
    if (!d || d.expires_at < new Date()) return null;
    return d.owner;
  }

  async close(): Promise<void> {
    await mongoose.disconnect();
  }
}
