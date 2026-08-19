const BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3000';

export interface ApiResult<T = any> {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string };
  status: number;
}

export async function apiCall<T = any>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    let json: any = {};
    try { json = await res.json(); } catch { /* empty body */ }
    const ok = res.ok && json.success !== false;
    return { ok, data: json.data as T, error: json.error, status: res.status };
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
