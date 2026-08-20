'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { DealBar } from '@/components/DealBar';
import { ActionButton, StepCard, inrUsd, usd } from '@/components/ui';
import { DocButton } from '@/components/DocViewer';
import { apiCall, apiGet, apiSeq, parseFile } from '@/lib/api';
import { ORG, useDeal } from '@/lib/deal';
import { escrowUsd } from '@/lib/amounts';
import type { Escrow, GRN, Invoice, PurchaseOrder } from '@/lib/types';

export default function BuyerPage() {
  const { code, ids } = useDeal();
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [grn, setGrn] = useState<GRN | null>(null);
  const [inv, setInv] = useState<Invoice | null>(null);
  const [esc, setEsc] = useState<Escrow | null>(null);
  // PO is the buyer's document — entered here or parsed from an uploaded file.
  const [item, setItem] = useState('Laptops');
  const [qty, setQty] = useState(100);
  const [price, setPrice] = useState(90000);
  const [poDocHash, setPoDocHash] = useState<string | null>(null);
  const [poDocName, setPoDocName] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseNote, setParseNote] = useState<string | null>(null);
  const poAmount = (qty || 0) * (price || 0);

  async function parsePo(file: File) {
    setParsing(true); setParseNote(null);
    const r = await parseFile(file);
    setParsing(false);
    if (!r) { setParseNote('Could not read that document.'); return; }
    if (r.fields.item) setItem(r.fields.item);
    const q = r.fields.quantity ?? qty;
    if (r.fields.quantity) setQty(r.fields.quantity);
    if (r.fields.amount && q > 0) setPrice(Math.round(r.fields.amount / q));
    setPoDocHash(r.doc_hash); setPoDocName(file.name);
    setParseNote(r.found.length ? `Auto-filled from ${file.name}: ${r.found.join(', ')}. Review below, then Create PO.` : `Read ${file.name} but found no fields — enter values manually.`);
  }

  const refresh = useCallback(async () => {
    if (!ids) return;
    const [p, g, i, e] = await Promise.all([
      apiGet<PurchaseOrder>(`/api/trade-docs/purchase-orders/${ids.po}`),
      apiGet<GRN>(`/api/trade-docs/grn/${ids.grn}`),
      apiGet<Invoice>(`/api/trade-docs/invoices/${ids.inv}`),
      apiGet<Escrow>(`/api/escrow/instructions/${ids.esc}`),
    ]);
    setPo(p); setGrn(g); setInv(i); setEsc(e);
  }, [ids]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  if (!code || !ids) {
    return (
      <main>
        <DealBar active="Buyer" />
        <div className="mx-auto max-w-2xl px-6 py-16 text-center text-slate-500">
          No active deal. Click <strong>New Deal</strong> above to start, or open the <Link href="/" className="text-brand underline">home page</Link>.
        </div>
      </main>
    );
  }

  const invReady = inv?.status === 'Approved' || inv?.status === 'Assigned';
  // Escrow amount derives from the invoice value — not hardcoded.
  const escInvAmount = inv?.amount ?? poAmount;
  const escInvQty = inv?.quantity ?? qty;
  const escUsd = escrowUsd(escInvAmount);

  return (
    <main>
      <DealBar active="Buyer" />
      <div className="mx-auto max-w-2xl space-y-4 px-6 py-8">
        <h1 className="text-xl font-bold text-indigo-700">Buyer</h1>

        <StepCard n={1} title="Create Purchase Order" status={po?.status}>
          {po ? (
            <p className="text-sm text-slate-600">
              {po.quantity?.toLocaleString('en-IN')} × {po.item_description} — {inrUsd(po.gross_value)}.
            </p>
          ) : (
            <>
              <p className="mb-2 text-xs text-slate-500">Enter the order details, or upload a PO document to auto-fill them.</p>
              <div className="grid grid-cols-3 gap-2">
                <label className="text-xs text-slate-500">Item
                  <input value={item} onChange={(e) => setItem(e.target.value)}
                    className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm text-slate-800" />
                </label>
                <label className="text-xs text-slate-500">Quantity
                  <input type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))}
                    className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm text-slate-800" />
                </label>
                <label className="text-xs text-slate-500">Price/unit (₹)
                  <input type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))}
                    className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm text-slate-800" />
                </label>
              </div>
              <p className="mt-1 text-sm text-slate-700">Order value: <span className="font-semibold">{inrUsd(poAmount)}</span></p>
              <label className={`mt-2 inline-flex items-center gap-1 rounded-lg border border-dashed px-2.5 py-1 text-xs font-semibold ${parsing ? 'cursor-wait border-slate-200 text-slate-400' : 'cursor-pointer border-indigo-300 text-indigo-600 hover:bg-indigo-50'}`}>
                🔍 {poDocName ? `Uploaded: ${poDocName}` : 'Upload & parse PO'}
                <input type="file" className="hidden" accept=".pdf,.txt,.png,.jpg,.jpeg"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) parsePo(f); }} />
              </label>
              {parsing && <span className="ml-2 text-xs text-slate-400">reading document…</span>}
              {parseNote && <p className="mt-1 text-xs text-emerald-600">{parseNote}</p>}
            </>
          )}
          <ActionButton label="Create PO" disabled={!!po || !(poAmount > 0)}
            run={() => apiCall('POST', '/api/trade-docs/purchase-orders', {
              po_id: ids.po, buyer_id: ORG.buyer, supplier_id: ORG.supplier, currency: 'INR',
              gross_value: poAmount, quantity: qty, price_per_unit: price,
              item_description: item, delivery_terms: '45 days', payment_terms: '30 days',
              doc_hash: poDocHash ?? `po-${code}`,
            })} onDone={refresh} />
          <DocButton doc={po ? { kind: 'PO', data: po } : null} label="View PO" />
        </StepCard>

        <StepCard n={2} title="Record Goods Receipt (GRN)" status={grn?.status}>
          Record delivery & accept {(po?.quantity ?? qty).toLocaleString('en-IN')} units.
          <ActionButton label="Record & Accept GRN"
            disabled={!!grn || !po || (po.status !== 'Acknowledged' && po.status !== 'Locked')}
            run={() => apiSeq([
              () => apiCall('POST', '/api/trade-docs/grn', { grn_id: ids.grn, po_id: ids.po, received_qty: po?.quantity ?? qty }),
              () => apiCall('PUT', `/api/trade-docs/grn/${ids.grn}/accept`),
            ])} onDone={refresh} />
          <DocButton doc={grn ? { kind: 'GRN', data: grn } : null} label="View GRN" />
        </StepCard>

        <StepCard n={3} title="Approve Invoice" status={inv?.status}>
          Approve the supplier&apos;s invoice ({inv ? inrUsd(inv.amount) : 'once raised'}) once the 3-way match passes.
          <ActionButton label="Approve Invoice" disabled={inv?.status !== 'Matched'}
            run={() => apiCall('PUT', `/api/trade-docs/invoices/${ids.inv}/approve`)} onDone={refresh} />
          <DocButton doc={inv ? { kind: 'INVOICE', data: inv } : null} label="View Invoice" />
        </StepCard>

        <StepCard n={4} title="Create & Fund Escrow" status={esc?.status}>
          Deposit {usd(escUsd)} into a programmable escrow, beneficiary = Lender.
          <ActionButton label="Create & Fund Escrow" disabled={!invReady || (!!esc && esc.status !== 'None')}
            run={() => apiSeq([
              () => apiCall('POST', '/api/trade-docs/invoices', { invoice_id: ids.escInv, supplier_id: ORG.supplier, buyer_id: ORG.buyer, po_id: ids.po, grn_id: ids.grn, amount: escInvAmount, quantity: escInvQty, currency: 'INR', due_date: '2024-12-31', doc_hash: `escinv-${code}` }),
              () => apiCall('PUT', `/api/trade-docs/invoices/${ids.escInv}/match`),
              () => apiCall('POST', '/api/escrow/instructions', { escrow_payment_id: ids.esc, buyer_org_id: ORG.buyer, beneficiary_org_id: ORG.lender, linked_invoice_id: ids.escInv, amount_usd: escUsd }),
              () => apiCall('POST', `/api/escrow/instructions/${ids.esc}/fund`),
            ])} onDone={refresh} />
        </StepCard>

        <StepCard n={5} title="Give Final Approval → Auto-Release" status={esc?.status}>
          Final approval flips the on-chain condition; the escrow auto-releases to the Lender across chains.
          <ActionButton label="Approve & Release" disabled={esc?.status !== 'Funded'}
            run={() => apiCall('PUT', `/api/trade-docs/invoices/${ids.escInv}/approve`)} onDone={refresh} />
          {esc?.status === 'Released' && <p className="mt-2 text-sm font-semibold text-emerald-600">Released {usd(escUsd)} to Lender ✓</p>}
        </StepCard>

        <StepCard n={6} title="Sad path — Refund (optional)">
          If a deal is cancelled before release, the escrow refunds the buyer.
          <ActionButton label="Refund This Escrow" disabled={esc?.status !== 'Funded'}
            run={() => apiCall('POST', `/api/escrow/instructions/${ids.esc}/refund`)} onDone={refresh} />
          {esc?.status === 'Refunded' && <p className="mt-2 text-sm font-semibold text-rose-600">Refunded to Buyer ✓</p>}
        </StepCard>
      </div>
    </main>
  );
}
