'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { motion } from 'motion/react';
import { Logo } from '@/components/Logo';
import { fadeUp, stagger } from '@/lib/motion';
import { ensureOrgs, useDeal } from '@/lib/deal';
import {
  IconBuyer, IconSupplier, IconLender, IconArrowRight, IconPlus,
  IconDoc, IconFinance, IconTruck, IconReceipt, IconLink, IconShield, IconClock,
} from '@/components/icons';

const ROLES = [
  { href: '/buyer', label: 'Buyer', Icon: IconBuyer, desc: 'Issue the order, receive goods, approve the invoice, fund & release escrow.', ring: 'hover:ring-brand-200', chip: 'bg-brand-50 text-brand-700' },
  { href: '/supplier', label: 'Supplier', Icon: IconSupplier, desc: 'Acknowledge the order, draw pre-shipment finance, raise the invoice, discount it for early cash.', ring: 'hover:ring-emerald-200', chip: 'bg-emerald-50 text-emerald-700' },
  { href: '/lender', label: 'Lender', Icon: IconLender, desc: 'Underwrite finance, set the quote, discount invoices with net settlement, collect from escrow.', ring: 'hover:ring-accent-200', chip: 'bg-accent-50 text-accent-dark' },
];

const FLOW = [
  { Icon: IconDoc, label: 'Purchase Order' },
  { Icon: IconFinance, label: 'Pre-shipment' },
  { Icon: IconTruck, label: 'Delivery / GRN' },
  { Icon: IconReceipt, label: 'Invoice + Match' },
  { Icon: IconLink, label: 'Discounting' },
  { Icon: IconShield, label: 'Escrow Release' },
];

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
    <main className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Logo size={30} />
        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500 ring-1 ring-line">Live demo</span>
      </header>

      <motion.section
        variants={stagger}
        initial="hidden"
        animate="show"
        className="mx-auto max-w-6xl px-6 pb-8 pt-6 sm:pt-12"
      >
        <motion.span variants={fadeUp} className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1 text-xs font-semibold text-brand-700 shadow-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Permissioned trade-finance network
        </motion.span>
        <motion.h1 variants={fadeUp} className="mt-5 max-w-3xl text-4xl font-bold leading-[1.1] tracking-tight text-ink sm:text-5xl">
          One verifiable chain from <span className="text-brand">purchase order</span> to <span className="text-accent-dark">payment</span>.
        </motion.h1>
        <motion.p variants={fadeUp} className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-600">
          CocoNet connects a buyer, a supplier and a lender around a single trade deal — provenance,
          document integrity, invoice discounting and programmable escrow settlement on one shared ledger.
        </motion.p>
        <motion.div variants={fadeUp} className="mt-8 flex flex-wrap items-center gap-3">
          <button
            onClick={startAndOpen}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white shadow-glow transition hover:bg-brand-dark disabled:opacity-60"
          >
            {busy ? <IconClock size={16} className="animate-spin" /> : <IconPlus size={16} />}
            {busy ? 'Starting…' : 'Start a new deal'}
          </button>
          <Link href="/buyer" className="inline-flex items-center gap-1.5 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-ink ring-1 ring-inset ring-line transition hover:bg-surface">
            Explore workspaces <IconArrowRight size={16} />
          </Link>
        </motion.div>
      </motion.section>

      {/* Flow strip */}
      <section className="mx-auto max-w-6xl px-6 pb-10">
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          className="flex flex-wrap items-center gap-x-2 gap-y-3 rounded-2xl border border-line bg-white/70 p-4 shadow-card backdrop-blur"
        >
          {FLOW.map(({ Icon, label }, i) => (
            <div key={label} className="flex items-center gap-2">
              <motion.div variants={fadeUp} className="inline-flex items-center gap-2 rounded-xl bg-surface px-3 py-2 text-sm font-medium text-ink">
                <Icon size={16} className="text-brand-600" /> {label}
              </motion.div>
              {i < FLOW.length - 1 && <IconArrowRight size={16} className="hidden text-slate-300 sm:block" />}
            </div>
          ))}
        </motion.div>
      </section>

      {/* Role cards */}
      <motion.section
        variants={stagger}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '-80px' }}
        className="mx-auto grid max-w-6xl gap-5 px-6 pb-16 sm:grid-cols-3"
      >
        {ROLES.map(({ href, label, Icon, desc, ring, chip }) => (
          <motion.div key={href} variants={fadeUp}>
            <Link
              href={href}
              className={`group flex h-full flex-col rounded-2xl border border-line bg-white p-6 shadow-card ring-1 ring-transparent transition-all hover:-translate-y-1 hover:shadow-elevated ${ring}`}
            >
              <span className={`inline-flex h-11 w-11 items-center justify-center rounded-xl ${chip}`}>
                <Icon size={22} />
              </span>
              <h2 className="mt-4 text-lg font-semibold text-ink">{label}</h2>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-500">{desc}</p>
              <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600">
                Open workspace <IconArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          </motion.div>
        ))}
      </motion.section>

      <footer className="mx-auto max-w-6xl px-6 pb-10">
        <p className="rounded-xl border border-line bg-white/60 px-4 py-3 text-xs leading-relaxed text-slate-500">
          <span className="font-semibold text-ink">Demo mode.</span> The three role workspaces are shown without login so you can see every side of the deal.
          In production they are authenticated, permissioned portals. Start a deal, then open the roles in separate tabs to drive the flow across them.
        </p>
      </footer>
    </main>
  );
}
