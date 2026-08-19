'use client';
import Link from 'next/link';
import { DealBar } from '@/components/DealBar';

const ROLES = [
  { href: '/buyer', label: 'Buyer', desc: 'Issues the order, records goods receipt, approves the invoice, funds & releases escrow.', color: 'border-indigo-200 hover:border-indigo-400' },
  { href: '/supplier', label: 'Supplier', desc: 'Acknowledges the order, takes pre-shipment finance, raises the invoice, applies for invoice discounting.', color: 'border-emerald-200 hover:border-emerald-400' },
  { href: '/lender', label: 'Lender', desc: 'Reviews & funds pre-shipment finance, discounts the invoice, collects from escrow.', color: 'border-amber-200 hover:border-amber-400' },
];

export default function Home() {
  return (
    <main>
      <DealBar />
      <div className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">CocoNet — Trade Finance Platform</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          A shared, tamper-proof platform connecting a buyer, a supplier, and a lender around one trade deal —
          from purchase order to <strong>invoice discounting</strong> to programmable escrow settlement.
        </p>
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Demo mode — the three role screens are shown without login so you can see all sides.
          In production these are authenticated, permissioned portals. Click <strong>New Deal</strong> above,
          then open the three roles (ideally in three browser tabs) and drive the flow across them.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {ROLES.map((r) => (
            <Link key={r.href} href={r.href}
              className={`rounded-xl border bg-white p-5 shadow-sm transition ${r.color}`}>
              <h2 className="text-lg font-semibold text-slate-900">{r.label}</h2>
              <p className="mt-2 text-sm text-slate-600">{r.desc}</p>
              <span className="mt-3 inline-block text-sm font-semibold text-brand">Open →</span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
