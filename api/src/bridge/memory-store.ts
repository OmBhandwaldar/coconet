import { BridgeStore, ClaimResult, DeadLetterRecord, InboxEntry } from './store.js';

// ─── In-memory BridgeStore ────────────────────────────────────────────────────
// Used by the tests, and as the explicit opt-out for a single-process dev run
// where Mongo is not up. It implements the same semantics as the Mongo store —
// including the stale-claim rule — so a test that passes here is a test about
// the bridge's logic rather than about a mock.
//
// It is NOT durable, which is the one thing the real store exists to be. Nothing
// should select it in production; see requireStore() in index.ts.
export class MemoryBridgeStore implements BridgeStore {
  private inbox = new Map<string, InboxEntry>();
  private checkpoints = new Map<string, string>();
  private dead = new Map<string, DeadLetterRecord>();
  private leases = new Map<string, { owner: string; expires: number }>();
  private seq = 0;

  private now(): string { return new Date().toISOString(); }

  async claimEvent(key: string, stream: string, staleAfterMs: number): Promise<ClaimResult> {
    const existing = this.inbox.get(key);
    if (!existing) {
      this.inbox.set(key, { key, stream, status: 'processing', attempts: 1, updated_at: this.now() });
      return 'new';
    }
    if (existing.status === 'done' || existing.status === 'dead') return 'duplicate';
    if (existing.status === 'failed') {
      existing.status = 'processing';
      existing.attempts += 1;
      existing.updated_at = this.now();
      return 'retry';
    }
    // status === 'processing': another worker has it, unless that worker died.
    const age = Date.now() - Date.parse(existing.updated_at);
    if (age < staleAfterMs) return 'duplicate';
    existing.attempts += 1;
    existing.updated_at = this.now();
    return 'retry';
  }

  async completeEvent(key: string): Promise<void> {
    const e = this.inbox.get(key);
    if (e) { e.status = 'done'; e.updated_at = this.now(); delete e.error; }
  }

  async failEvent(
    key: string, error: string, maxAttempts: number, payload?: Record<string, unknown>,
  ): Promise<{ attempts: number; dead: boolean }> {
    const e = this.inbox.get(key);
    if (!e) return { attempts: 0, dead: false };
    e.error = error;
    e.updated_at = this.now();
    if (payload) e.payload = payload;
    const dead = e.attempts >= maxAttempts;
    e.status = dead ? 'dead' : 'failed';
    if (dead) {
      this.dead.set(key, {
        id: String(++this.seq), key, stream: e.stream, error,
        attempts: e.attempts, payload, failed_at: this.now(),
      });
    }
    return { attempts: e.attempts, dead };
  }

  async getEntry(key: string): Promise<InboxEntry | null> {
    const e = this.inbox.get(key);
    return e ? { ...e } : null;
  }

  async dueForRetry(stream: string, limit: number): Promise<InboxEntry[]> {
    return [...this.inbox.values()]
      .filter((e) => e.stream === stream && e.status === 'failed')
      .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
      .slice(0, limit)
      .map((e) => ({ ...e }));
  }

  async checkpoint(stream: string): Promise<string | null> {
    return this.checkpoints.get(stream) ?? null;
  }

  async setCheckpoint(stream: string, position: string): Promise<void> {
    this.checkpoints.set(stream, position);
  }

  async listDeadLetters(limit: number): Promise<DeadLetterRecord[]> {
    return [...this.dead.values()]
      .sort((a, b) => b.failed_at.localeCompare(a.failed_at))
      .slice(0, limit);
  }

  async reopenDeadLetter(key: string): Promise<boolean> {
    if (!this.dead.delete(key)) return false;
    const e = this.inbox.get(key);
    if (e) { e.status = 'failed'; e.attempts = 0; e.updated_at = this.now(); }
    return true;
  }

  async acquireLease(name: string, owner: string, ttlMs: number): Promise<boolean> {
    const held = this.leases.get(name);
    if (held && held.owner !== owner && held.expires > Date.now()) return false;
    this.leases.set(name, { owner, expires: Date.now() + ttlMs });
    return true;
  }

  async releaseLease(name: string, owner: string): Promise<void> {
    if (this.leases.get(name)?.owner === owner) this.leases.delete(name);
  }

  async leaseOwner(name: string): Promise<string | null> {
    const held = this.leases.get(name);
    return held && held.expires > Date.now() ? held.owner : null;
  }

  async close(): Promise<void> { /* nothing to close */ }
}
