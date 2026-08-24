'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { IconArrowRight, IconCheck, IconScan } from '@/components/icons';

export function PageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-7">
      <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">{title}</h1>
      <p className="mt-2 max-w-2xl text-[0.95rem] leading-relaxed text-slate-500">{subtitle}</p>
    </motion.div>
  );
}

export function EmptyDeal() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-white/60 py-20 text-center">
      <p className="text-sm text-slate-500">No active deal.</p>
      <Link href="/" className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600">
        Start one from the home page <IconArrowRight size={15} />
      </Link>
    </div>
  );
}

export function ResultBanner({ tone, children }: { tone: 'good' | 'bad' | 'special'; children: ReactNode }) {
  const cls =
    tone === 'good' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
    : tone === 'special' ? 'bg-violet-50 text-violet-700 ring-violet-200'
    : 'bg-rose-50 text-rose-700 ring-rose-200';
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className={`mt-3 inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold ring-1 ring-inset ${cls}`}>
      <IconCheck size={16} /> {children}
    </motion.div>
  );
}

// Amber alert surfaced when a 3-way match fails, so the reason is visible
// instead of a silently-disabled Approve button.
export function MatchAlert({ reasons }: { reasons?: string[] }) {
  if (!reasons?.length) return null;
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className="mt-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800 ring-1 ring-inset ring-amber-200">
      <p className="font-semibold">3-way match failed</p>
      <ul className="mt-1 list-inside list-disc text-xs leading-relaxed">
        {reasons.map((r) => <li key={r}>{r}</li>)}
      </ul>
      <p className="mt-1.5 text-xs text-amber-700">Start a new deal and raise the invoice within the delivered quantity &amp; PO value.</p>
    </motion.div>
  );
}

export function UploadChip({ label, busy, onFile }: { label: string; busy?: boolean; onFile: (f: File) => void }) {
  return (
    <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-brand-300 px-3 py-1.5 text-xs font-semibold text-brand-600 transition hover:bg-brand-50 ${busy ? 'cursor-wait opacity-60' : ''}`}>
      <IconScan size={15} /> {busy ? 'Reading…' : label}
      <input type="file" className="hidden" accept=".pdf,.txt,.png,.jpg,.jpeg" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
    </label>
  );
}
