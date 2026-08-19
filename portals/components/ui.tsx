'use client';
import { ReactNode, useState } from 'react';
import type { ApiResult } from '@/lib/api';

const FX = 92; // 1 USD = ₹92

export function inr(n: number): string {
  return '₹' + n.toLocaleString('en-IN');
}
export function inrUsd(n: number): string {
  return `₹${n.toLocaleString('en-IN')} / $${Math.round(n / FX).toLocaleString('en-US')}`;
}
export function usd(n: number): string {
  return '$' + n.toLocaleString('en-US');
}

const STATUS_COLORS: Record<string, string> = {
  Issued: 'bg-blue-100 text-blue-700',
  Acknowledged: 'bg-blue-100 text-blue-700',
  Locked: 'bg-amber-100 text-amber-700',
  Fulfilled: 'bg-emerald-100 text-emerald-700',
  Submitted: 'bg-slate-100 text-slate-700',
  Matched: 'bg-indigo-100 text-indigo-700',
  Approved: 'bg-emerald-100 text-emerald-700',
  Eligible: 'bg-emerald-100 text-emerald-700',
  Assigned: 'bg-violet-100 text-violet-700',
  Requested: 'bg-slate-100 text-slate-700',
  'Under Review': 'bg-amber-100 text-amber-700',
  Offered: 'bg-blue-100 text-blue-700',
  Accepted: 'bg-indigo-100 text-indigo-700',
  Disbursed: 'bg-emerald-100 text-emerald-700',
  Repaid: 'bg-emerald-100 text-emerald-700',
  Created: 'bg-slate-100 text-slate-700',
  Funded: 'bg-blue-100 text-blue-700',
  Released: 'bg-emerald-100 text-emerald-700',
  Refunded: 'bg-rose-100 text-rose-700',
};

export function StatusBadge({ status }: { status?: string }) {
  if (!status) return <span className="text-xs text-slate-400">—</span>;
  const cls = STATUS_COLORS[status] ?? 'bg-slate-100 text-slate-700';
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{status}</span>;
}

export function StepCard({
  n, title, status, children,
}: { n: number; title: string; status?: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">{n}</span>
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        </div>
        <StatusBadge status={status} />
      </div>
      <div className="text-sm text-slate-600">{children}</div>
    </div>
  );
}

export function ActionButton({
  label, run, onDone, disabled,
}: {
  label: string;
  run: () => Promise<ApiResult>;
  onDone?: () => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function click() {
    setBusy(true); setErr(null);
    const r = await run();
    setBusy(false);
    if (!r.ok) setErr(r.error?.message ?? `Failed (${r.status})`);
    onDone?.();
  }

  return (
    <div className="mt-2">
      <button
        onClick={click}
        disabled={disabled || busy}
        className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? 'Working…' : label}
      </button>
      {err && <p className="mt-1 text-xs text-rose-600">{err}</p>}
    </div>
  );
}
