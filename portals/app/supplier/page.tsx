'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { DealBar } from '@/components/DealBar';
import { ActionButton, StepCard, inrUsd } from '@/components/ui';
import { DocButton } from '@/components/DocViewer';
import { DocUpload } from '@/components/DocUpload';
import { ParseImport } from '@/components/ParseImport';
import { apiCall, apiGet, apiSeq } from '@/lib/api';
import { ORG, useDeal } from '@/lib/deal';
import { AMT, discGross, preShipAmount } from '@/lib/amounts';
import type { FinanceRequest, GRN, Invoice, PurchaseOrder } from '@/lib/types';

export default function SupplierPage() {
  const { code, ids } = useDeal();
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [grn, setGrn] = useState<GRN | null>(null);
  const [inv, setInv] = useState<Invoice | null>(null);
  const [frPre, setFrPre] = useState<FinanceRequest | null>(null);
  const [frDisc, setFrDisc] = useState<FinanceRequest | null>(null);
  const [invDocHash, setInvDocHash] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!ids) return;
    const [p, g, i, fp, fd] = await Promise.all([
      apiGet<PurchaseOrder>(`/api/trade-docs/purchase-orders/${ids.po}`),
      apiGet<GRN>(`/api/trade-docs/grn/${ids.grn}`),
      apiGet<Invoice>(`/api/trade-docs/invoices/${ids.inv}`),
      apiGet<FinanceRequest>(`/api/finance/${ids.frPre}`),
      apiGet<FinanceRequest>(`/api/finance/${ids.frDisc}`),
    ]);
    setPo(p); setGrn(g); setInv(i); setFrPre(fp); setFrDisc(fd);
  }, [ids]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  // Derived from the actual on-chain values (parsed or entered) — not hardcoded.
  const preShip = preShipAmount(po?.gross_value ?? AMT.poGross);
  const discAmt = discGross(inv?.amount ?? AMT.invAmount);
  // Invoice bills the accepted GRN qty at the PO unit price — so a short delivery
  // (accepted < ordered) correctly bills less than the full PO value.
  const invQty = grn?.accepted_qty ?? AMT.invQty;
  const unitPrice = po?.price_per_unit ?? (po ? Math.round(po.gross_value / (po.quantity || 1)) : 0);
  const invAmt = po ? invQty * unitPrice : AMT.invAmount;

  if (!code || !ids) {
    return (
      <main>
        <DealBar active="Supplier" />
        <div className="mx-auto max-w-2xl px-6 py-16 text-center text-slate-500">
          No active deal. Start one from the <Link href="/" className="text-brand underline">home page</Link> (Buyer usually starts it).
        </div>
      </main>
    );
  }

  return (
    <main>
      <DealBar active="Supplier" />
      <div className="mx-auto max-w-2xl space-y-4 px-6 py-8">
        <h1 className="text-xl font-bold text-emerald-700">Supplier</h1>

        <StepCard n={1} title="Acknowledge Purchase Order" status={po?.status}>
          Accept the buyer&apos;s order ({po ? inrUsd(po.gross_value) : inrUsd(AMT.poGross)}).
          <ActionButton label="Acknowledge PO" disabled={po?.status !== 'Issued'}
            run={() => apiCall('PUT', `/api/trade-docs/purchase-orders/${ids.po}/acknowledge`, { supplier_id: ORG.supplier })} onDone={refresh} />
          <DocButton doc={po ? { kind: 'PO', data: po } : null} label="View PO" />
        </StepCard>

        <StepCard n={2} title="Request Pre-Shipment Finance" status={frPre?.status}>
          Borrow {inrUsd(preShip)} against the PO to fund production.
          <ActionButton label="Request Pre-Shipment Finance" disabled={po?.status !== 'Acknowledged' || !!frPre}
            run={() => apiCall('POST', '/api/finance/pre-shipment', { request_id: ids.frPre, po_id: ids.po, requestor_org_id: ORG.supplier, requested_amount: preShip, lender_id: ORG.lender })} onDone={refresh} />
        </StepCard>

        <StepCard n={3} title="Accept Finance Offer" status={frPre?.security_interest_state === 'Perfected' ? 'Accepted' : frPre?.status}>
          Accept the lender&apos;s offer — this locks the PO as security.
          <ActionButton label="Accept Offer" disabled={frPre?.status !== 'Offered'}
            run={() => apiCall('PUT', `/api/finance/${ids.frPre}/accept`)} onDone={refresh} />
        </StepCard>

        <StepCard n={4} title="Raise Invoice" status={inv?.status}>
          Raise the invoice for the accepted quantity ({inrUsd(invAmt)}); the platform runs the 3-way match.
          <DocUpload label="Attach invoice document (optional)" disabled={!!inv} onUploaded={(h) => setInvDocHash(h)} />
          <ActionButton label="Raise Invoice + 3-Way Match" disabled={!grn?.accepted_qty || !!inv}
            run={() => apiSeq([
              () => apiCall('POST', '/api/trade-docs/invoices', { invoice_id: ids.inv, supplier_id: ORG.supplier, buyer_id: ORG.buyer, po_id: ids.po, grn_id: ids.grn, amount: invAmt, quantity: invQty, currency: 'INR', due_date: '2024-12-31', doc_hash: invDocHash ?? `inv-${code}` }),
              () => apiCall('PUT', `/api/trade-docs/invoices/${ids.inv}/match`),
            ])} onDone={refresh} />
          <ParseImport
            label="Parse & import from document"
            showDueDate
            disabled={!grn?.accepted_qty || !!inv}
            defaults={{ amount: invAmt, quantity: invQty, due_date: '2024-12-31' }}
            onSubmit={(c, h) => apiSeq([
              () => apiCall('POST', '/api/trade-docs/invoices', { invoice_id: ids.inv, supplier_id: ORG.supplier, buyer_id: ORG.buyer, po_id: ids.po, grn_id: ids.grn, amount: c.amount, quantity: c.quantity, currency: 'INR', due_date: c.due_date ?? '2024-12-31', doc_hash: h }),
              () => apiCall('PUT', `/api/trade-docs/invoices/${ids.inv}/match`),
            ])}
            onDone={refresh} />
          <DocButton doc={inv ? { kind: 'INVOICE', data: inv } : null} label="View Invoice" />
        </StepCard>

        <StepCard n={5} title="Apply for Invoice Discounting" status={frDisc?.status}>
          Sell the approved invoice ({inrUsd(inv?.amount ?? AMT.invAmount)}) to the lender at a {(AMT.discRate * 100).toFixed(0)}% discount for early cash.
          <ActionButton label="Apply for Invoice Discounting" disabled={inv?.status !== 'Approved' || !!frDisc}
            run={() => apiCall('POST', '/api/finance/invoice-discounting', { request_id: ids.frDisc, invoice_id: ids.inv, requestor_org_id: ORG.supplier, requested_amount: discAmt, lender_id: ORG.lender, discount_rate: AMT.discRate })} onDone={refresh} />
        </StepCard>

        <StepCard n={6} title="Accept Discounting Offer" status={frDisc?.status}>
          Accept the lender&apos;s discounting offer — ownership of the invoice transfers to the lender.
          <ActionButton label="Accept Discounting Offer" disabled={frDisc?.status !== 'Offered'}
            run={() => apiCall('PUT', `/api/finance/${ids.frDisc}/accept`)} onDone={refresh} />
          {frDisc?.net_disbursed != null && (
            <p className="mt-2 text-sm font-semibold text-emerald-600">
              Net received: {inrUsd(frDisc.net_disbursed)} (pre-shipment loan auto-settled)
            </p>
          )}
        </StepCard>
      </div>
    </main>
  );
}
