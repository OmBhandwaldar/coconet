// ─── Bridge durability store ──────────────────────────────────────────────────
// The bridge is the only component whose failure silently loses money movement:
// a Fabric event that should have released an escrow, dropped because a Polygon
// write failed or the process restarted mid-handler. Nothing retries it and
// nothing reports it missing.
//
// Four pieces of state make that recoverable, and all four have to be durable —
// in-process state is lost in exactly the restart it exists to survive:
//
//   checkpoint   how far through each chain's event stream we have read, so a
//                restart resumes instead of skipping to the next block
//   inbox        every event key we have seen and its outcome, so a redelivery
//                is a no-op rather than a second release
//   dead letters deliveries that exhausted their retries, kept for an operator
//                rather than logged and forgotten
//   lease        which process is the active bridge, so two API replicas do not
//                both process the same event
//
// The interface is here and the Mongo implementation is alongside it, because
// the tests drive a real in-memory implementation rather than mocks: idempotency
// and retry are claims about sequences of calls, and a mock that returns
// whatever the test says proves nothing about them.

/**
 * Outcome of trying to claim an event for processing.
 *
 * `retry` is distinct from `new` because it means a previous attempt started and
 * did not finish — the handler must assume partial work may already be on chain
 * and rely on the on-chain state being the judge of what still needs doing.
 */
export type ClaimResult = 'new' | 'duplicate' | 'retry';

export interface DeadLetter {
  key: string;
  stream: string;
  error: string;
  attempts: number;
  payload?: Record<string, unknown>;
}

export interface DeadLetterRecord extends DeadLetter {
  id: string;
  failed_at: string;
}

export interface InboxEntry {
  key: string;
  stream: string;
  status: 'processing' | 'done' | 'failed' | 'dead';
  attempts: number;
  updated_at: string;
  error?: string;
}

export interface BridgeStore {
  /**
   * Atomically take ownership of an event. The atomicity is the whole point: two
   * workers calling this concurrently must not both get `new`.
   *
   * `staleAfterMs` decides when a claim left `processing` by a dead process
   * becomes available again — without it, a crash mid-handler strands the event
   * as permanently in-flight.
   */
  claimEvent(key: string, stream: string, staleAfterMs: number): Promise<ClaimResult>;

  /** The handler finished. Further deliveries of this key are duplicates. */
  completeEvent(key: string): Promise<void>;

  /**
   * The handler threw. Returns the attempt count and whether this exhausted the
   * budget — in which case the event is dead-lettered rather than retried for ever.
   */
  failEvent(
    key: string, error: string, maxAttempts: number, payload?: Record<string, unknown>,
  ): Promise<{ attempts: number; dead: boolean }>;

  /** Inbox entry for a key, or null. Used by reconciliation and diagnostics. */
  getEntry(key: string): Promise<InboxEntry | null>;

  /** Events left `failed` and due for another attempt, oldest first. */
  dueForRetry(stream: string, limit: number): Promise<InboxEntry[]>;

  checkpoint(stream: string): Promise<string | null>;
  setCheckpoint(stream: string, position: string): Promise<void>;

  listDeadLetters(limit: number): Promise<DeadLetterRecord[]>;
  /** Clear a dead letter and reopen its inbox entry so it is retried. */
  reopenDeadLetter(key: string): Promise<boolean>;

  /**
   * Take or extend the bridge lease. Returns false when another live owner holds
   * it. The TTL is what makes this survive a crash: a dead leader's lease
   * expires and another process takes over without human intervention.
   */
  acquireLease(name: string, owner: string, ttlMs: number): Promise<boolean>;
  releaseLease(name: string, owner: string): Promise<void>;
  leaseOwner(name: string): Promise<string | null>;

  close(): Promise<void>;
}
