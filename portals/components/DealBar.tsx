'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ensureOrgs, useDeal } from '@/lib/deal';

const ROLES = [
  { href: '/buyer', label: 'Buyer', color: 'text-indigo-600' },
  { href: '/supplier', label: 'Supplier', color: 'text-emerald-600' },
  { href: '/lender', label: 'Lender', color: 'text-amber-600' },
];

export function DealBar({ active }: { active?: string }) {
  const { code, setDeal, newCode } = useDeal();
  const [busy, setBusy] = useState(false);

  async function startNew() {
    setBusy(true);
    await ensureOrgs();
    setDeal(newCode());
    setBusy(false);
  }

  return (
    <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-3">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-sm font-bold text-slate-900">CocoNet</Link>
          <nav className="flex gap-3 text-sm">
            {ROLES.map((r) => (
              <Link key={r.href} href={r.href}
                className={`font-medium ${active === r.label ? `${r.color} underline` : 'text-slate-500 hover:text-slate-800'}`}>
                {r.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            Deal: {code ? <span className="font-mono font-semibold text-slate-800">{code}</span> : <span className="italic text-slate-400">none</span>}
          </span>
          <button onClick={startNew} disabled={busy}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {busy ? 'Starting…' : 'New Deal'}
          </button>
        </div>
      </div>
    </div>
  );
}
