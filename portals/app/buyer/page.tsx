'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { DealBar } from '@/components/DealBar';
import { ActionButton, StepCard, inrUsd, usd } from '@/components/ui';
import { DocButton } from '@/components/DocViewer';
import { apiCall, apiGet, apiSeq } from '@/lib/api';
import { ORG, useDeal } from '@/lib/deal';
import { AMT } from '@/lib/amounts';
import type { Escrow, GRN, Invoice, PurchaseOrder } from '@/lib/types';

export default function BuyerPage() {
  const { code, ids } = useDeal();
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [grn, setGrn] = useState<GRN | null>(null);
  const [inv, setInv] = useState<Invoice | null>(null);
  const [esc, setEsc] = useState<Escrow | null>(null);

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

  return (
    <main>
      <DealBar active="Buyer" />
      <div className="mx-auto max-w-2xl space-y-4 px-6 py-8">
        <h1 className="text-xl font-bold text-indigo-700">Buyer</h1>

        <StepCard n={1} title="Create Purchase Order" status={po?.status}>
          Order {AMT.poQty.toLocaleString('en-IN')} units — {inrUsd(AMT.poGross)}.
          <ActionButton label="Create PO" disabled={!!po}
            run={() => apiCall('POST', '/api/trade-docs/purchase-orders', {
              po_id: ids.po, buyer_id: ORG.buyer, supplier_id: ORG.supplier, currency: 'INR',
              gross_value: AMT.poGross, quantity: AMT.poQty, price_per_unit: AMT.poPrice,
              item_description: 'Steel panels', delivery_terms: '45 days', payment_terms: '30 days', doc_hash: `po-${code}`,
            })} onDone={refresh} />
          <DocButton doc={po ? { kind: 'PO', data: po } : null} label="View PO" />
        </StepCard>

        <StepCard n={2} title="Record Goods Receipt (GRN)" status={grn?.status}>
          Record delivery & accept {AMT.grnQty.toLocaleString('en-IN')} units.
          <ActionButton label="Record & Accept GRN"
            disabled={!!grn || !po || (po.status !== 'Acknowledged' && po.status !== 'Locked')}
            run={() => apiSeq([
              () => apiCall('POST', '/api/trade-docs/grn', { grn_id: ids.grn, po_id: ids.po, received_qty: AMT.grnQty }),
              () => apiCall('PUT', `/api/trade-docs/grn/${ids.grn}/accept`),
            ])} onDone={refresh} />
          <DocButton doc={grn ? { kind: 'GRN', data: grn } : null} label="View GRN" />
        </StepCard>

        <StepCard n={3} title="Approve Invoice" status={inv?.status}>
          Approve the supplier&apos;s invoice ({inrUsd(AMT.invAmount)}) once the 3-way match passes.
          <ActionButton label="Approve Invoice" disabled={inv?.status !== 'Matched'}
            run={() => apiCall('PUT', `/api/trade-docs/invoices/${ids.inv}/approve`)} onDone={refresh} />
          <DocButton doc={inv ? { kind: 'INVOICE', data: inv } : null} label="View Invoice" />
        </StepCard>

        <StepCard n={4} title="Create & Fund Escrow" status={esc?.status}>
          Deposit {usd(AMT.escUsd)} into a programmable escrow, beneficiary = Lender.
          <ActionButton label="Create & Fund Escrow" disabled={!invReady || (!!esc && esc.status !== 'None')}
            run={() => apiSeq([
              () => apiCall('POST', '/api/trade-docs/invoices', { invoice_id: ids.escInv, supplier_id: ORG.supplier, buyer_id: ORG.buyer, po_id: ids.po, grn_id: ids.grn, amount: AMT.invAmount, quantity: AMT.invQty, currency: 'INR', due_date: '2024-12-31', doc_hash: `escinv-${code}` }),
              () => apiCall('PUT', `/api/trade-docs/invoices/${ids.escInv}/match`),
              () => apiCall('POST', '/api/escrow/instructions', { escrow_payment_id: ids.esc, buyer_org_id: ORG.buyer, beneficiary_org_id: ORG.lender, linked_invoice_id: ids.escInv, amount_usd: AMT.escUsd }),
              () => apiCall('POST', `/api/escrow/instructions/${ids.esc}/fund`),
            ])} onDone={refresh} />
        </StepCard>

        <StepCard n={5} title="Give Final Approval → Auto-Release" status={esc?.status}>
          Final approval flips the on-chain condition; the escrow auto-releases to the Lender across chains.
          <ActionButton label="Approve & Release" disabled={esc?.status !== 'Funded'}
            run={() => apiCall('PUT', `/api/trade-docs/invoices/${ids.escInv}/approve`)} onDone={refresh} />
          {esc?.status === 'Released' && <p className="mt-2 text-sm font-semibold text-emerald-600">Released {usd(AMT.escUsd)} to Lender ✓</p>}
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
