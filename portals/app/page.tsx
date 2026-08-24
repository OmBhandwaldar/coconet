'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { motion } from 'motion/react';
import { Logo, LogoMark } from '@/components/Logo';
import { fadeUp, stagger } from '@/lib/motion';
import { ensureOrgs, useDeal } from '@/lib/deal';
import {
  IconBuyer, IconSupplier, IconLender, IconArrowRight, IconPlus, IconClock,
  IconFinance, IconLink,
} from '@/components/icons';

export default function Home() {
  const { setDeal, newCode } = useDeal();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function startAndOpen() {
    setBusy(true);
    await ensureOrgs();
    setDeal(newCode());
    setBusy(false);
    router.push('/buyer');
  }

  return (
    <main className="min-h-dvh scroll-smooth bg-paper px-2 py-2 sm:px-3 sm:py-3">
      <div className="mx-auto max-w-[88rem] space-y-4">
        {/* ── TOP NAV (light) ──────────────────────────────────────────── */}
        <header className="flex items-center justify-between px-2 py-2 sm:px-4 sm:py-3">
          <Link href="/" aria-label="CocoNet home"><Logo size={30} /></Link>
          <nav className="flex items-center gap-2 sm:gap-3">
            <a href="#workspaces" className="rounded-full px-4 py-2 text-sm font-semibold text-slate-600 transition hover:text-ink">
              Workspaces
            </a>
            <button onClick={startAndOpen} disabled={busy}
              className="inline-flex items-center gap-2 rounded-full bg-lime px-5 py-2.5 text-sm font-bold text-night transition hover:bg-lime-600 disabled:opacity-70">
              {busy ? <IconClock size={15} className="animate-spin" /> : <IconPlus size={15} />}
              {busy ? 'Starting…' : 'Start a deal'}
            </button>
          </nav>
        </header>

        {/* ── HERO (dark card) ─────────────────────────────────────────── */}
        <motion.section
          variants={stagger} initial="hidden" animate="show"
          className="relative overflow-hidden rounded-[2rem] bg-night px-6 py-9 text-white sm:px-10 sm:py-12"
        >
          {/* ambient glows */}
          <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-lime/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-32 left-1/3 h-80 w-80 rounded-full bg-brand-500/10 blur-3xl" />

          <div className="relative grid items-center gap-8 lg:grid-cols-2">
            {/* copy */}
            <div>
              <motion.span variants={fadeUp} className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/80 ring-1 ring-inset ring-white/10">
                Live demo <span className="h-1.5 w-1.5 rounded-full bg-lime" />
              </motion.span>
              <motion.h1 variants={fadeUp} className="mt-5 text-4xl font-bold leading-[1.03] tracking-tight sm:text-5xl lg:text-6xl">
                Move money the<br className="hidden sm:block" /> moment the trade<br className="hidden sm:block" /> is <span className="text-lime">verified</span>
              </motion.h1>
              <motion.p variants={fadeUp} className="mt-5 max-w-md text-[0.95rem] leading-relaxed text-white/60">
                One permissioned chain for buyers, suppliers and lenders — provenance, invoice
                discounting and programmable escrow settlement, all in one place.
              </motion.p>
              <motion.div variants={fadeUp} className="mt-8 flex flex-wrap items-center gap-3">
                <button onClick={startAndOpen} disabled={busy}
                  className="inline-flex items-center gap-2 rounded-full bg-lime px-6 py-3 text-sm font-bold text-night transition hover:bg-lime-600 disabled:opacity-70">
                  {busy ? <IconClock size={16} className="animate-spin" /> : <IconPlus size={16} />}
                  {busy ? 'Starting…' : 'Start a deal'}
                </button>
                <Link href="/buyer"
                  className="inline-flex items-center gap-2 rounded-full bg-white/10 px-6 py-3 text-sm font-semibold text-white ring-1 ring-inset ring-white/15 transition hover:bg-white/15">
                  Explore workspaces <IconArrowRight size={16} />
                </Link>
              </motion.div>
            </div>

            {/* floating document cards */}
            <motion.div variants={fadeUp} className="relative hidden h-72 lg:block">
              <FloatingDoc
                className="absolute left-4 top-4 rotate-[-9deg]"
                tint="from-slate-700 to-slate-900" label="PURCHASE ORDER" ref1="PO-2024-0892" amount="₹1,00,00,000" delay={0}
              />
              <FloatingDoc
                className="absolute right-2 top-24 rotate-[7deg]"
                tint="from-[#2b4d3a] to-[#16241c]" label="TAX INVOICE" ref1="INV-2024-0892" amount="₹90,00,000" delay={0.4}
              />
            </motion.div>
          </div>
        </motion.section>

        {/* ── STATEMENT ────────────────────────────────────────────────── */}
        <motion.section
          variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-80px' }}
          className="my-10 grid gap-6 px-6 py-16 sm:my-16 sm:px-10 sm:py-24 lg:grid-cols-[auto,1fr] lg:items-center lg:gap-12"
        >
          <motion.span variants={fadeUp} className="w-fit text-base font-bold uppercase tracking-widest text-slate-500">
            Why CocoNet
          </motion.span>
          <motion.h2 variants={fadeUp} className="ml-auto max-w-2xl text-right text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl">
            Financing, verification and settlement that used to take weeks — collapsed into one shared, tamper-proof timeline.
          </motion.h2>
        </motion.section>

        {/* ── BENTO features ───────────────────────────────────────────── */}
        <motion.section
          variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-80px' }}
          className="grid gap-4 sm:grid-cols-2"
        >
          <BentoCard tone="lime" title="Get financed before you ship." body="Draw pre-shipment finance against a verified purchase order — production funded, PO locked as security." Icon={IconFinance} />
          <BentoCard tone="dark" title="Turn approved invoices into instant cash." body="Sell a matched invoice to a lender at a discount, with the earlier loan auto-settled on disbursement." Icon={IconLink} />
        </motion.section>

        {/* ── ROLES ────────────────────────────────────────────────────── */}
        <motion.section
          id="workspaces"
          variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-80px' }}
          className="scroll-mt-6 rounded-[2rem] bg-white px-6 py-10 sm:px-10"
        >
          <motion.div variants={fadeUp} className="mb-6 flex items-center gap-3">
            <span className="inline-flex items-center rounded-full border border-line px-3 py-1 text-[0.65rem] font-bold uppercase tracking-widest text-slate-500">Workspaces</span>
            <p className="text-sm text-slate-500">Open a role and drive the deal — best across three tabs.</p>
          </motion.div>
          <div className="grid gap-4 sm:grid-cols-3">
            <RoleCard href="/buyer" label="Buyer" Icon={IconBuyer} desc="Issue the order, confirm delivery, approve the invoice, fund & release escrow." />
            <RoleCard href="/supplier" label="Supplier" Icon={IconSupplier} desc="Acknowledge the order, draw finance, raise the invoice, discount it for early cash." />
            <RoleCard href="/lender" label="Lender" Icon={IconLender} desc="Underwrite finance, quote your terms, discount invoices, collect from escrow." />
          </div>
        </motion.section>

        {/* ── CTA + note ───────────────────────────────────────────────── */}
        <section className="relative overflow-hidden rounded-[2rem] bg-night px-6 py-10 text-white sm:px-10">
          <div className="pointer-events-none absolute -right-20 -bottom-24 h-72 w-72 rounded-full bg-lime/10 blur-3xl" />
          <div className="relative flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">See the whole trade move end to end.</h2>
              <p className="mt-2 max-w-md text-sm text-white/55">Spin up a deal and walk it from purchase order to cross-chain escrow release in minutes.</p>
            </div>
            <button onClick={startAndOpen} disabled={busy}
              className="inline-flex shrink-0 items-center gap-2 rounded-full bg-lime px-6 py-3 text-sm font-bold text-night transition hover:bg-lime-600 disabled:opacity-70">
              {busy ? <IconClock size={16} className="animate-spin" /> : <IconPlus size={16} />}
              {busy ? 'Starting…' : 'Start a deal'}
            </button>
          </div>
          <p className="relative mt-8 border-t border-white/10 pt-5 text-xs leading-relaxed text-white/45">
            Demo mode — the role workspaces are shown without login so you can see every side of the deal.
            In production they are authenticated, permissioned portals.
          </p>
        </section>
      </div>
    </main>
  );
}

// A tilted, gently-floating trade-document card for the hero visual.
function FloatingDoc({ className = '', tint, label, ref1, amount, delay }: {
  className?: string; tint: string; label: string; ref1: string; amount: string; delay: number;
}) {
  return (
    <motion.div
      animate={{ y: [0, -10, 0] }}
      transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut', delay }}
      className={`w-64 rounded-2xl bg-gradient-to-br ${tint} p-5 shadow-elevated ring-1 ring-white/10 ${className}`}
    >
      <div className="flex items-center justify-between">
        <LogoMark size={22} />
        <div className="h-6 w-8 rounded-md bg-white/15" />
      </div>
      <p className="mt-6 text-[0.6rem] font-semibold uppercase tracking-widest text-white/50">{label}</p>
      <p className="mt-1 font-mono text-xs text-white/70">{ref1}</p>
      <div className="mt-4 flex items-end justify-between">
        <div className="space-y-1.5">
          <div className="h-1.5 w-20 rounded-full bg-white/15" />
          <div className="h-1.5 w-14 rounded-full bg-white/10" />
        </div>
        <span className="tnum text-lg font-bold text-white">{amount}</span>
      </div>
    </motion.div>
  );
}

function BentoCard({ tone, title, body, Icon }: {
  tone: 'lime' | 'dark'; title: string; body: string; Icon: typeof IconFinance;
}) {
  const dark = tone === 'dark';
  return (
    <motion.div
      variants={fadeUp}
      whileHover={{ scale: 1.015 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
      className={`relative flex min-h-[16rem] flex-col justify-between overflow-hidden rounded-[2rem] p-7 ${dark ? 'bg-night text-white' : 'bg-lime text-night'}`}
    >
      {dark && <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-lime/10 blur-3xl" />}
      <div className="relative flex items-start justify-between">
        <h3 className="max-w-[14rem] text-2xl font-bold leading-tight tracking-tight">{title}</h3>
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${dark ? 'bg-white/10 text-lime' : 'bg-night/10 text-night'}`}>
          <Icon size={22} />
        </span>
      </div>
      <p className={`relative mt-6 max-w-sm text-sm leading-relaxed ${dark ? 'text-white/60' : 'text-night/70'}`}>{body}</p>
    </motion.div>
  );
}

function RoleCard({ href, label, Icon, desc }: { href: string; label: string; Icon: typeof IconBuyer; desc: string }) {
  return (
    <motion.div variants={fadeUp}>
      <Link
        href={href}
        className="group flex h-full flex-col rounded-2xl border border-line bg-surface p-6 transition-all hover:-translate-y-1 hover:border-brand-200 hover:shadow-elevated"
      >
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white text-brand-600 ring-1 ring-inset ring-line">
          <Icon size={22} />
        </span>
        <h3 className="mt-4 text-lg font-semibold text-ink">{label}</h3>
        <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-500">{desc}</p>
        <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600">
          Open <IconArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>
    </motion.div>
  );
}
