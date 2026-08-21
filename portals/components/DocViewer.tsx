'use client';
import { ReactNode, useState } from 'react';
import { inrUsd } from './ui';
import { docUrl, isRealHash } from '@/lib/api';
import type { GRN, Invoice, PurchaseOrder } from '@/lib/types';

const ORG_NAME: Record<string, string> = {
  'tata-001': 'Buyer Corp', 'bharat-001': 'Supplier Ltd', 'hdfc-001': 'Lender Bank',
};
const name = (id?: string) => (id && ORG_NAME[id]) || id || '—';
const fmtDate = (s?: string) => (s ? new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-sm text-slate-800">{children}</div>
    </div>
  );
}

function Stamp({ status }: { status: string }) {
  return (
    <span className="rotate-[-8deg] rounded border-2 border-emerald-500 px-2 py-0.5 text-xs font-bold uppercase text-emerald-600">
      {status}
    </span>
  );
}

function Hash({ h }: { h?: string }) {
  if (!h) return null;
  const real = isRealHash(h);
  return (
    <div className="mt-4 rounded bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
      <span className="font-semibold text-slate-600">On-chain fingerprint:</span>{' '}
      <span className="font-mono break-all">{h}</span>
      <span className="ml-1 text-emerald-600">✓ verified</span>
      {real && (
        <div className="mt-1">
          <a href={docUrl(h)} target="_blank" rel="noreferrer" className="font-semibold text-brand hover:underline">
            Open original file ↗
          </a>
        </div>
      )}
    </div>
  );
}

function POView({ po }: { po: PurchaseOrder }) {
  return (
    <>
      <Header title="PURCHASE ORDER" no={po.po_id} status={po.status} />
      <div className="grid grid-cols-2 gap-4 border-b border-slate-100 pb-3">
        <Field label="Buyer">{name(po.buyer_id)}</Field>
        <Field label="Supplier">{name(po.supplier_id)}</Field>
        <Field label="Date">{fmtDate(po.created_at)}</Field>
        <Field label="Currency">{po.currency}</Field>
      </div>
      <table className="my-3 w-full text-sm">
        <thead><tr className="border-b border-slate-200 text-left text-xs text-slate-400">
          <th className="py-1">Item</th><th className="text-right">Qty</th><th className="text-right">Price/unit</th><th className="text-right">Amount</th>
        </tr></thead>
        <tbody><tr>
          <td className="py-2">{po.item_description || 'Goods'}</td>
          <td className="text-right">{po.quantity?.toLocaleString('en-IN')}</td>
          <td className="text-right">{po.price_per_unit ? `₹${po.price_per_unit.toLocaleString('en-IN')}` : '—'}</td>
          <td className="text-right font-semibold">{inrUsd(po.gross_value)}</td>
        </tr></tbody>
      </table>
      <div className="flex justify-between text-sm">
        <span className="text-slate-500">Delivery: {po.delivery_terms || '—'} · Payment: {po.payment_terms || '—'}</span>
        <span className="font-bold">Total: {inrUsd(po.gross_value)}</span>
      </div>
      <Hash h={po.doc_hash} />
    </>
  );
}

function InvoiceView({ inv }: { inv: Invoice }) {
  const rate = inv.quantity ? Math.round(inv.amount / inv.quantity) : 0;
  return (
    <>
      <Header title="TAX INVOICE" no={inv.invoice_id} status={inv.status} />
      <div className="grid grid-cols-2 gap-4 border-b border-slate-100 pb-3">
        <Field label="From (Supplier)">{name(inv.supplier_id)}</Field>
        <Field label="Bill to (Buyer)">{name(inv.buyer_id)}</Field>
        <Field label="PO Reference">{inv.po_id}</Field>
        <Field label="GRN Reference">{inv.grn_id}</Field>
        <Field label="Invoice Date">{fmtDate(inv.created_at)}</Field>
        <Field label="Due Date">{fmtDate(inv.due_date)}</Field>
      </div>
      <table className="my-3 w-full text-sm">
        <thead><tr className="border-b border-slate-200 text-left text-xs text-slate-400">
          <th className="py-1">Description</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Amount</th>
        </tr></thead>
        <tbody><tr>
          <td className="py-2">Goods (accepted quantity)</td>
          <td className="text-right">{inv.quantity?.toLocaleString('en-IN')}</td>
          <td className="text-right">₹{rate.toLocaleString('en-IN')}</td>
          <td className="text-right font-semibold">{inrUsd(inv.amount)}</td>
        </tr></tbody>
      </table>
      <div className="flex justify-between text-sm">
        <span className="text-slate-500">{inv.assigned_to ? `Assigned to: ${name(inv.assigned_to)}` : 'Assignment: —'}</span>
        <span className="font-bold">Total: {inrUsd(inv.amount)}</span>
      </div>
      <Hash h={inv.doc_hash} />
    </>
  );
}

function GRNView({ grn }: { grn: GRN }) {
  return (
    <>
      <Header title="GOODS RECEIPT NOTE" no={grn.grn_id} status={grn.status} />
      <div className="grid grid-cols-2 gap-4">
        <Field label="PO Reference">{grn.po_id}</Field>
        <Field label="Date">{fmtDate(grn.created_at)}</Field>
        <Field label="Received Qty">{grn.received_qty?.toLocaleString('en-IN')}</Field>
        <Field label="Accepted Qty">{grn.accepted_qty?.toLocaleString('en-IN') ?? '—'}</Field>
      </div>
      <Hash h={grn.doc_hash} />
    </>
  );
}

function Header({ title, no, status }: { title: string; no: string; status: string }) {
  return (
    <div className="mb-3 flex items-start justify-between border-b-2 border-slate-800 pb-2">
      <div>
        <div className="text-lg font-bold tracking-wide text-slate-900">{title}</div>
        <div className="font-mono text-xs text-slate-500">{no}</div>
      </div>
      <Stamp status={status} />
    </div>
  );
}

type Doc =
  | { kind: 'PO'; data: PurchaseOrder }
  | { kind: 'INVOICE'; data: Invoice }
  | { kind: 'GRN'; data: GRN };

export function DocButton({ doc, label }: { doc: Doc | null; label?: string }) {
  const [open, setOpen] = useState(false);
  if (!doc?.data) return null;

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="mt-2 inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">
        📄 {label ?? 'View Document'}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setOpen(false)}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex justify-end">
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>
            {doc.kind === 'PO' && <POView po={doc.data} />}
            {doc.kind === 'INVOICE' && <InvoiceView inv={doc.data} />}
            {doc.kind === 'GRN' && <GRNView grn={doc.data} />}
          </div>
        </div>
      )}
    </>
  );
}
