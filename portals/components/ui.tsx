'use client';
import { ReactNode, useState } from 'react';
import { motion } from 'motion/react';
import type { ApiResult } from '@/lib/api';
import { fadeUp } from '@/lib/motion';
import { IconCheck, IconClock } from '@/components/icons';

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

// status → { dot, chip } semantic colours.
type Tone = 'neutral' | 'progress' | 'info' | 'good' | 'special' | 'bad';
const STATUS_TONE: Record<string, Tone> = {
  Issued: 'info', Acknowledged: 'info', Locked: 'progress', Fulfilled: 'good',
  Submitted: 'neutral', Matched: 'info', Approved: 'good', Eligible: 'good',
  Assigned: 'special', Requested: 'neutral', 'Under Review': 'progress',
  Offered: 'info', Accepted: 'info', Disbursed: 'good', Repaid: 'good',
  Created: 'neutral', Funded: 'info', Released: 'good', Refunded: 'bad',
  None: 'neutral',
};
const TONE_CLS: Record<Tone, { chip: string; dot: string }> = {
  neutral: { chip: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' },
  progress: { chip: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200', dot: 'bg-amber-500' },
  info: { chip: 'bg-brand-50 text-brand-700 ring-1 ring-brand-100', dot: 'bg-brand-500' },
  good: { chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', dot: 'bg-emerald-500' },
  special: { chip: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200', dot: 'bg-violet-500' },
  bad: { chip: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200', dot: 'bg-rose-500' },
};

export function StatusBadge({ status }: { status?: string }) {
  if (!status) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-400 ring-1 ring-slate-200">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-300" /> Pending
      </span>
    );
  }
  const tone = STATUS_TONE[status] ?? 'neutral';
  const { chip, dot } = TONE_CLS[tone];
  const done = tone === 'good';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot} ${tone === 'progress' ? 'animate-pulse' : ''}`} />
      {status}
    </span>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      variants={fadeUp}
      className={`rounded-2xl border border-line bg-white shadow-card ${className}`}
    >
      {children}
    </motion.div>
  );
}

// One action in a role workflow — icon, title, description, live status, controls.
// No step numbers: state is conveyed by the status pill and the enabled/disabled CTA.
export function ActionCard({
  icon, title, desc, status, done, children,
}: {
  icon: ReactNode;
  title: string;
  desc?: ReactNode;
  status?: string;
  done?: boolean;
  children?: ReactNode;
}) {
  return (
    <motion.div
      variants={fadeUp}
      whileHover={{ y: -2 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className="group relative overflow-hidden rounded-2xl border border-line bg-white p-5 shadow-card transition-shadow hover:shadow-elevated"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${done ? 'bg-emerald-50 text-emerald-600' : 'bg-brand-50 text-brand-600'} ring-1 ring-inset ${done ? 'ring-emerald-100' : 'ring-brand-100'}`}>
            {done ? <IconCheck size={20} /> : icon}
          </span>
          <div>
            <h3 className="text-[0.95rem] font-semibold leading-tight text-ink">{title}</h3>
            {desc && <p className="mt-1 text-sm leading-relaxed text-slate-500">{desc}</p>}
          </div>
        </div>
        <StatusBadge status={status} />
      </div>
      {children && <div className="mt-4">{children}</div>}
    </motion.div>
  );
}

export function ActionButton({
  label, run, onDone, disabled, variant = 'primary', icon,
}: {
  label: string;
  run: () => Promise<ApiResult>;
  onDone?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'ghost';
  icon?: ReactNode;
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

  const cls = variant === 'primary'
    ? 'bg-brand text-white shadow-sm hover:bg-brand-dark disabled:bg-slate-200 disabled:text-slate-400'
    : 'bg-white text-slate-700 ring-1 ring-inset ring-line hover:bg-surface disabled:text-slate-300';

  return (
    <div className="flex flex-col gap-1">
      <motion.button
        whileTap={disabled || busy ? undefined : { scale: 0.97 }}
        onClick={click}
        disabled={disabled || busy}
        className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${cls}`}
      >
        {busy ? <IconClock size={16} className="animate-spin" /> : icon}
        {busy ? 'Working…' : label}
      </motion.button>
      {err && <p className="max-w-xs text-xs leading-snug text-rose-600">{err}</p>}
    </div>
  );
}

// Small labelled field (used in forms).
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-xs font-medium text-slate-500">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

export const inputCls =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100';
