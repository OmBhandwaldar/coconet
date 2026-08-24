'use client';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { Logo, LogoMark } from '@/components/Logo';
import { IconBuyer, IconSupplier, IconLender, IconPlus, IconClock } from '@/components/icons';
import { ensureOrgs, useDeal } from '@/lib/deal';

type RoleKey = 'Buyer' | 'Supplier' | 'Lender';
const ROLES: { href: string; label: RoleKey; Icon: typeof IconBuyer; accent: string; dot: string }[] = [
  { href: '/buyer', label: 'Buyer', Icon: IconBuyer, accent: 'text-brand-700 bg-brand-50 ring-brand-100', dot: 'bg-brand-500' },
  { href: '/supplier', label: 'Supplier', Icon: IconSupplier, accent: 'text-emerald-700 bg-emerald-50 ring-emerald-100', dot: 'bg-emerald-500' },
  { href: '/lender', label: 'Lender', Icon: IconLender, accent: 'text-accent-dark bg-accent-50 ring-accent-100', dot: 'bg-accent-400' },
];

function DealControl({ compact = false }: { compact?: boolean }) {
  const { code, setDeal, newCode } = useDeal();
  const [busy, setBusy] = useState(false);
  async function startNew() {
    setBusy(true);
    await ensureOrgs();
    setDeal(newCode());
    setBusy(false);
  }
  return (
    <div className={`flex items-center gap-2 ${compact ? '' : 'w-full'}`}>
      <div className={`flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-1.5 ${compact ? '' : 'flex-1'}`}>
        <span className={`h-2 w-2 rounded-full ${code ? 'bg-emerald-500' : 'bg-slate-300'}`} />
        <span className="text-[0.7rem] font-medium uppercase tracking-wide text-slate-400">Deal</span>
        <span className="tnum truncate font-mono text-xs font-semibold text-ink">{code ?? 'none'}</span>
      </div>
      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={startNew}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-xl bg-ink px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-ink-soft disabled:opacity-60"
      >
        {busy ? <IconClock size={14} className="animate-spin" /> : <IconPlus size={14} />}
        {busy ? 'Starting' : 'New Deal'}
      </motion.button>
    </div>
  );
}

export function AppShell({ active, children }: { active?: RoleKey; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-paper">
      {/* Sidebar (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-paper lg:flex">
        <div className="flex h-16 items-center px-5">
          <Link href="/" aria-label="CocoNet home"><Logo size={28} /></Link>
        </div>
        <nav className="flex flex-col gap-1 px-3 py-2">
          <p className="px-2 pb-1 pt-3 text-[0.65rem] font-semibold uppercase tracking-widest text-slate-400">Workspaces</p>
          {ROLES.map(({ href, label, Icon, accent, dot }) => {
            const on = active === label;
            return (
              <Link key={href} href={href}
                className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  on ? `${accent} ring-1 ring-inset` : 'text-slate-600 hover:bg-surface'
                }`}>
                {on && <motion.span layoutId="nav-active" className={`absolute left-0 h-6 w-1 rounded-r-full ${dot}`} />}
                <Icon size={18} />
                {label}
              </Link>
            );
          })}
        </nav>
        {/* <div className="mt-auto p-4">
          <div className="rounded-xl border border-line bg-surface p-3">
            <p className="text-[0.7rem] font-semibold text-ink">Demo workspace</p>
            <p className="mt-1 text-[0.7rem] leading-relaxed text-slate-500">
              Unauthenticated for the walkthrough. In production these are permissioned, signed-in portals.
            </p>
          </div>
        </div> */}
      </aside>

      {/* Main column */}
      <div className="lg:pl-64">
        {/* Top bar */}
        <header className="sticky top-0 z-20 border-b border-line bg-paper/85 backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-5 sm:px-8">
            <Link href="/" className="lg:hidden" aria-label="CocoNet home"><LogoMark size={26} /></Link>
            <div className="hidden items-center gap-2 lg:flex">
              {active && <span className="text-sm font-semibold text-ink">{active} workspace</span>}
            </div>
            <DealControl compact />
          </div>
          {/* Mobile role nav */}
          <nav className="flex gap-1 overflow-x-auto border-t border-line px-3 py-2 lg:hidden">
            {ROLES.map(({ href, label, Icon, accent }) => {
              const on = active === label;
              return (
                <Link key={href} href={href}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${on ? `${accent} ring-1 ring-inset` : 'text-slate-500'}`}>
                  <Icon size={15} /> {label}
                </Link>
              );
            })}
          </nav>
        </header>

        <main className="mx-auto max-w-5xl px-5 py-7 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
