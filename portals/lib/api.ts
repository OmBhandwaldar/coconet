const BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3000';

export interface ApiResult<T = any> {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string };
  status: number;
  /**
   * The call succeeded but the transition is waiting for a second signature
   * (BR-09). It arrives as a 202, because the chaincode cannot throw when it
   * parks a transition without rolling back the approval record it just wrote —
   * so a screen that only checks `ok` would show the action as complete.
   */
  pending?: boolean;
}

// ─── Demo authentication ──────────────────────────────────────────────────────
// The API now requires a token and restricts each action to the party whose
// action it is. These screens have no login by design — they are a demo view of
// all three sides at once — so each page declares which person it is acting as
// and the client signs in lazily on that person's behalf.
//
// This is a demo affordance, not portal authentication. Real login, sessions and
// server-side fetching are Block 10 in NEW-PLAN.md.
const tokens = new Map<string, string>();
let actor = 'platform';

/** Called once per page to say who this screen acts as (e.g. 'rajesh'). */
export function actAs(username: string) { actor = username; }

async function tokenFor(username: string): Promise<string | null> {
  const cached = tokens.get(username);
  if (cached) return cached;
  try {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, secret: `${username}-dev-secret` }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const token = json?.data?.token as string | undefined;
    if (token) tokens.set(username, token);
    return token ?? null;
  } catch {
    return null;
  }
}

export async function apiCall<T = any>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  return apiCallAs(actor, method, path, body);
}

/**
 * One call as somebody other than the screen's own actor — what a checker needs.
 * A screen declares a single actor with actAs(), but an approval queue is by
 * definition acted on by a second person in the same organisation.
 */
export async function apiCallAs<T = any>(
  username: string, method: string, path: string, body?: unknown,
): Promise<ApiResult<T>> {
  try {
    const headers: Record<string, string> = {};
    if (body) headers['content-type'] = 'application/json';
    const token = await tokenFor(username);
    if (token) headers.authorization = `Bearer ${token}`;

    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    let json: any = {};
    try { json = await res.json(); } catch { /* empty body */ }
    const ok = res.ok && json.success !== false;
    return {
      ok, data: json.data as T, error: json.error, status: res.status,
      pending: json.pending_approval === true,
    };
  } catch (e: any) {
    return { ok: false, error: { message: e?.message ?? 'Network error' }, status: 0 };
  }
}

// GET that returns data or null if not found / not yet created.
export async function apiGet<T>(path: string): Promise<T | null> {
  const r = await apiCall<T>('GET', path);
  return r.ok ? ((r.data ?? null) as T | null) : null;
}

// Run calls in sequence; stop at the first failure and return it, else the last result.
export async function apiSeq(calls: Array<() => Promise<ApiResult>>): Promise<ApiResult> {
  let last: ApiResult = { ok: true, status: 200 };
  for (const c of calls) {
    last = await c();
    if (!last.ok) return last;
  }
  return last;
}

export const API_BASE = BASE;

// On-chain activity feed. Pass a deal code to scope to one deal; omit for all deals.
export async function fetchActivity(deal?: string): Promise<{ entries: import('./types').ActivityEntry[]; lastSeq: number }> {
  const q = deal ? `?deal=${encodeURIComponent(deal)}&limit=300` : '?limit=300';
  const r = await apiCall<{ entries: import('./types').ActivityEntry[]; lastSeq: number }>('GET', `/api/activity${q}`);
  return r.ok && r.data ? r.data : { entries: [], lastSeq: 0 };
}

// Upload a real document file → returns its on-chain SHA-256 fingerprint (or null).
export async function uploadFile(file: File): Promise<string | null> {
  const fd = new FormData();
  fd.append('file', file);
  try {
    const token = await tokenFor(actor);
    const res = await fetch(`${BASE}/api/trade-docs/documents/upload`, {
      method: 'POST',
      body: fd,
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j?.data?.doc_hash ?? null;
  } catch {
    return null;
  }
}

export interface ParseResult {
  doc_hash: string;
  fields: { amount?: number; quantity?: number; item?: string; invoice_number?: string; po_number?: string; due_date?: string };
  found: string[];
  text_snippet: string;
}

// Upload a document and extract its fields (self-contained text extraction).
export async function parseFile(file: File): Promise<ParseResult | null> {
  const fd = new FormData();
  fd.append('file', file);
  try {
    const token = await tokenFor(actor);
    const res = await fetch(`${BASE}/api/trade-docs/documents/parse`, {
      method: 'POST',
      body: fd,
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) return null;
    const j = await res.json();
    return (j?.data as ParseResult) ?? null;
  } catch {
    return null;
  }
}

// URL to view/download a stored document by its fingerprint.
export function docUrl(hash: string): string {
  return `${BASE}/api/trade-docs/documents/${hash}`;
}

// A real stored file is keyed by a 64-char SHA-256; placeholder hashes are not.
export function isRealHash(h?: string): boolean {
  return !!h && /^[0-9a-f]{64}$/.test(h);
}
