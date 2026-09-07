'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { motion } from 'motion/react';
import { Logo } from '@/components/Logo';
import { fadeUp, stagger } from '@/lib/motion';
import { ensureOrgs, useDeal, type Rail } from '@/lib/deal';
import {
  IconArrowRight, IconPlus, IconClock, IconFinance, IconLink,
} from '@/components/icons';

export default function Home() {
  const { setDeal, newCode } = useDeal();
  // Settlement rail is picked before the deal starts and drives every money leg.
  const [rail, setRailChoice] = useState<Rail>('onchain');
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function startAndOpen() {
    setBusy(true);
    await ensureOrgs();
    setDeal(newCode(), rail);
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
            <Link href="/buyer" className="rounded-full px-4 py-2 text-sm font-semibold text-slate-600 transition hover:text-ink">
              Workspaces
            </Link>
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
          className="relative overflow-hidden rounded-[2rem] bg-night px-16 py-12 text-white sm:px-24 sm:py-20"
        >
          {/* ambient glows */}
          <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-lime/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-32 left-1/3 h-80 w-80 rounded-full bg-brand-500/10 blur-3xl" />

          <div className="relative grid items-center gap-8 lg:grid-cols-2">
            {/* copy */}
            <div>
              <motion.h1 variants={fadeUp} className="mt-5 text-4xl font-bold leading-[1.03] tracking-tight sm:text-5xl lg:text-6xl">
                Move money the<br className="hidden sm:block" /> moment the trade<br className="hidden sm:block" /> is <span className="text-lime">verified</span>
              </motion.h1>
              <motion.p variants={fadeUp} className="mt-5 max-w-md text-[0.95rem] leading-relaxed text-white/60">
                One permissioned chain for buyers, suppliers and lenders - provenance, invoice
                discounting and programmable escrow settlement, all in one place.
              </motion.p>
              <motion.div variants={fadeUp} className="mt-8 flex flex-wrap items-center gap-3">
                <RailToggle rail={rail} onChange={setRailChoice} />
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

            {/* floating status cards */}
            <motion.div variants={fadeUp} className="relative hidden h-[22rem] lg:block">
              {/* back — dark deal card */}
              <div className="absolute right-4 top-10 w-64 -rotate-6 rounded-2xl border border-white/10 bg-gradient-to-br from-[#2A2C26] to-[#17181A] p-5 shadow-2xl">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Trade deal</p>
                <p className="mt-1 text-sm font-bold text-white">TM-2024-0892</p>
                <p className="mt-4 text-2xl font-extrabold text-lime">₹90,00,000</p>
                <p className="mt-3 text-xs text-white/40">Tata Motors &middot; Invoice</p>
              </div>
              {/* front — lime status card */}
              <div className="absolute right-16 top-28 w-64 rotate-3 rounded-2xl border border-black/5 bg-lime p-5 text-night shadow-xl">
                <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">Status</p>
                <p className="mt-1 text-sm font-bold">Ready to release</p>
                <div className="mt-4 h-1.5 w-full rounded-full bg-black/10">
                  <div className="h-full w-3/4 rounded-full bg-black/70" />
                </div>
                <p className="mt-3 text-xs opacity-70">3 of 4 conditions met</p>
              </div>
            </motion.div>
          </div>
        </motion.section>

        {/* ── STATEMENT ────────────────────────────────────────────────── */}
        <motion.section
          variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-80px' }}
          className="my-20 grid gap-6 px-6 py-16 sm:my-28 sm:px-10 sm:py-24 lg:grid-cols-[auto,1fr] lg:items-center lg:gap-12"
        >
          <motion.span variants={fadeUp} className="w-fit text-base font-bold uppercase tracking-widest text-slate-500">
            Why CocoNet
          </motion.span>
          <motion.h2 variants={fadeUp} className="ml-auto max-w-2xl text-right text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl">
            Financing, verification and settlement that used to take weeks, collapsed into one shared, tamper-proof timeline.
          </motion.h2>
        </motion.section>

        {/* ── BENTO features ───────────────────────────────────────────── */}
        <motion.section
          variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-80px' }}
          className="grid gap-4 sm:grid-cols-2"
        >
          <BentoCard tone="lime" title="Get financed before you ship." body="Draw pre-shipment finance against a verified purchase order, production funded, PO locked as security." Icon={IconFinance} />
          <BentoCard tone="dark" title="Turn approved invoices into instant cash." body="Sell a matched invoice to a lender at a discount, with the earlier loan auto-settled on disbursement." Icon={IconLink} />
        </motion.section>

        {/* ── STATEMENT 2 (mirrored) ───────────────────────────────────── */}
        <motion.section
          variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-80px' }}
          className="my-20 grid gap-6 px-6 py-16 sm:my-28 sm:px-10 sm:py-24 lg:grid-cols-[1fr,auto] lg:items-center lg:gap-12"
        >
          <motion.h2 variants={fadeUp} className="max-w-2xl text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl">
            Buyers, suppliers and lenders act on one shared, verified timeline, no reconciling emails, ERP exports or banking portals.
          </motion.h2>
          <motion.span variants={fadeUp} className="w-fit text-base font-bold uppercase tracking-widest text-slate-500 lg:text-right">
            One network
          </motion.span>
        </motion.section>

        {/* ── CTA + note ───────────────────────────────────────────────── */}
        <section className="relative overflow-hidden rounded-[2rem] bg-night px-6 py-10 text-white sm:px-10">
          <div className="pointer-events-none absolute -right-20 -bottom-24 h-72 w-72 rounded-full bg-lime/10 blur-3xl" />
          <div className="relative flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">See the whole trade move end to end.</h2>
              <p className="mt-2 max-w-md text-sm text-white/55">Spin up a deal and walk it from purchase order to release.</p>
            </div>
            <button onClick={startAndOpen} disabled={busy}
              className="inline-flex shrink-0 items-center gap-2 rounded-full bg-lime px-6 py-3 text-sm font-bold text-night transition hover:bg-lime-600 disabled:opacity-70">
              {busy ? <IconClock size={16} className="animate-spin" /> : <IconPlus size={16} />}
              {busy ? 'Starting…' : 'Start a deal'}
            </button>
          </div>
          {/* <p className="relative mt-8 border-t border-white/10 pt-5 text-xs leading-relaxed text-white/45">
            Demo mode — the role workspaces are shown without login so you can see every side of the deal.
            In production they are authenticated, permissioned portals.
          </p> */}
        </section>
      </div>
    </main>
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

function RailToggle({ rail, onChange }: { rail: Rail; onChange: (r: Rail) => void }) {
  return (
    <div className="inline-flex items-center rounded-full bg-white/10 p-1 ring-1 ring-inset ring-white/15">
      {([['onchain', 'On-chain'], ['bank', 'Bank']] as const).map(([key, label]) => (
        <button key={key} onClick={() => onChange(key)}
          className={`rounded-full px-3.5 py-2 text-sm font-semibold transition ${rail === key ? 'bg-lime text-night' : 'text-white/70 hover:text-white'}`}>
          {label}
        </button>
      ))}
    </div>
  );
}
