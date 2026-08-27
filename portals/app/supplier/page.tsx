'use client';
import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { AppShell } from '@/components/AppShell';
import { Pipeline, type Stage } from '@/components/Pipeline';
import { ActionButton, ActionCard, inrUsd } from '@/components/ui';
import { DocButton } from '@/components/DocViewer';
import { DocUpload } from '@/components/DocUpload';
import { ParseImport } from '@/components/ParseImport';
import { PageHeader, EmptyDeal, ResultBanner, MatchAlert } from '@/components/workspace';
import { apiCall, apiGet, apiSeq } from '@/lib/api';
import { ORG, useDeal } from '@/lib/deal';
import { AMT, discGross, preShipAmount } from '@/lib/amounts';
import { stagger } from '@/lib/motion';
import { IconDoc, IconFinance, IconReceipt, IconCheck, IconLink, IconCoins } from '@/components/icons';
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
  // Prefer the lender's real terms once they exist: approved amount → quoted advance
  // rate × PO → the original ask → a pre-request estimate at the default rate.
  const preShip =
    frPre?.approved_amount
    ?? (frPre?.advance_rate != null ? Math.round((po?.gross_value ?? AMT.poGross) * frPre.advance_rate) : undefined)
    ?? frPre?.requested_amount
    ?? preShipAmount(po?.gross_value ?? AMT.poGross);
  const discAmt = discGross(inv?.amount ?? AMT.invAmount);
  // Invoice bills the accepted GRN qty at the PO unit price — a short delivery bills less.
  const invQty = grn?.accepted_qty ?? AMT.invQty;
  const unitPrice = po?.price_per_unit ?? (po ? Math.round(po.gross_value / (po.quantity || 1)) : 0);
  const invAmt = po ? invQty * unitPrice : AMT.invAmount;

  if (!code || !ids) return <AppShell active="Supplier"><EmptyDeal /></AppShell>;

  const finDone = frPre?.status === 'Disbursed';
  const invReady = inv?.status === 'Approved' || inv?.status === 'Assigned';
  const discDone = inv?.assignment_status === 'Assigned' || frDisc?.status === 'Disbursed';

  const stages: Stage[] = [
    { label: 'Acknowledge', state: po && po.status !== 'Issued' ? 'done' : po ? 'active' : 'todo' },
    { label: 'Finance', state: finDone ? 'done' : frPre ? 'active' : 'todo' },
    { label: 'Invoice', state: invReady ? 'done' : inv ? 'active' : 'todo' },
    { label: 'Discounting', state: discDone ? 'done' : frDisc ? 'active' : 'todo' },
  ];

  return (
    <AppShell active="Supplier">
      <PageHeader
        title="Supplier workspace"
        subtitle="Accept the order, draw pre-shipment finance against it, raise the invoice, and sell it to the lender for early cash."
      />
      <div className="mb-6"><Pipeline stages={stages} /></div>

      <motion.div variants={stagger} initial="hidden" animate="show" className="grid gap-4">
        <ActionCard
          icon={<IconDoc size={20} />}
          title="Acknowledge Purchase Order"
          desc={<>Accept the buyer&apos;s order ({po ? inrUsd(po.gross_value) : '—'}).</>}
          status={po?.status}
          done={!!po && po.status !== 'Issued'}
        >
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton label="Acknowledge PO" icon={<IconCheck size={16} />} disabled={po?.status !== 'Issued'}
              run={() => apiCall('PUT', `/api/trade-docs/purchase-orders/${ids.po}/acknowledge`, { supplier_id: ORG.supplier })} onDone={refresh} />
            <DocButton doc={po ? { kind: 'PO', data: po } : null} label="View PO" />
          </div>
        </ActionCard>

        <ActionCard
          icon={<IconFinance size={20} />}
          title="Pre-Shipment Finance"
          desc={frPre?.advance_rate != null ? (
            <>Lender&apos;s offer: {inrUsd(preShip)} ({(frPre.advance_rate * 100).toFixed(0)}% of the PO)
              {frPre.interest_rate != null && <> @ {(frPre.interest_rate * 100).toFixed(0)}%</>}
              {frPre.tenor_days != null && <> for {frPre.tenor_days} days</>}. Accept it to lock the PO as security.</>
          ) : (
            <>Borrow {inrUsd(preShip)} against the PO to fund production, then accept the lender&apos;s offer to lock it as security.</>
          )}
          status={frPre?.security_interest_state === 'Perfected' ? 'Accepted' : frPre?.status}
          done={finDone || frPre?.security_interest_state === 'Perfected'}
        >
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton label="Request Finance" icon={<IconCoins size={16} />} disabled={po?.status !== 'Acknowledged' || !!frPre}
              run={() => apiCall('POST', '/api/finance/pre-shipment', { request_id: ids.frPre, po_id: ids.po, requestor_org_id: ORG.supplier, requested_amount: preShip, lender_id: ORG.lender })} onDone={refresh} />
            <ActionButton label="Accept Offer" variant="ghost" disabled={frPre?.status !== 'Offered'}
              run={() => apiCall('PUT', `/api/finance/${ids.frPre}/accept`)} onDone={refresh} />
          </div>
        </ActionCard>

        <ActionCard
          icon={<IconReceipt size={20} />}
          title="Raise Invoice"
          desc={<>Bill the accepted quantity ({inrUsd(invAmt)}); the platform runs the 3-way match automatically.</>}
          status={inv?.status}
          done={invReady}
        >
          <div className="space-y-3">
            <DocUpload label="Attach invoice document" disabled={!!inv} onUploaded={(h) => setInvDocHash(h)} />
            <div className="flex flex-wrap items-center gap-2">
              <ActionButton label="Raise Invoice + Match" icon={<IconReceipt size={16} />} disabled={!grn?.accepted_qty || !!inv}
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
            </div>
            {inv?.status === 'Submitted' && inv.match_result?.passed === false && (
              <>
                <MatchAlert reasons={inv.match_result.reasons} />
                <div className="rounded-xl border border-line bg-surface p-3">
                  <p className="text-xs font-semibold text-ink">Correct &amp; resubmit</p>
                  <p className="mt-0.5 text-xs text-slate-500">Issue a revised invoice within the delivered quantity ({invQty.toLocaleString('en-IN')} units) and PO value — it re-runs the 3-way match on the same invoice.</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <ActionButton label={`Raise Corrected Invoice (${inrUsd(invAmt)})`} icon={<IconReceipt size={16} />}
                      run={() => apiCall('PUT', `/api/trade-docs/invoices/${ids.inv}/revise`, { amount: invAmt, quantity: invQty })} onDone={refresh} />
                    <ParseImport
                      label="Parse corrected document"
                      showDueDate={false}
                      defaults={{ amount: invAmt, quantity: invQty }}
                      onSubmit={(c, h) => apiCall('PUT', `/api/trade-docs/invoices/${ids.inv}/revise`, { amount: c.amount, quantity: c.quantity, doc_hash: h })}
                      onDone={refresh} />
                  </div>
                </div>
              </>
            )}
          </div>
        </ActionCard>

        <ActionCard
          icon={<IconLink size={20} />}
          title="Invoice Discounting"
          desc={<>Sell the approved invoice ({inrUsd(inv?.amount ?? invAmt)}) to the lender at a {(AMT.discRate * 100).toFixed(0)}% discount, then accept to transfer ownership.</>}
          status={frDisc?.status}
          done={discDone}
        >
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton label="Apply for Discounting" icon={<IconLink size={16} />} disabled={inv?.status !== 'Approved' || !!frDisc}
              run={() => apiCall('POST', '/api/finance/invoice-discounting', { request_id: ids.frDisc, invoice_id: ids.inv, requestor_org_id: ORG.supplier, requested_amount: discAmt, lender_id: ORG.lender, discount_rate: AMT.discRate })} onDone={refresh} />
            <ActionButton label="Accept Offer" variant="ghost" disabled={frDisc?.status !== 'Offered'}
              run={() => apiCall('PUT', `/api/finance/${ids.frDisc}/accept`)} onDone={refresh} />
          </div>
          {frDisc?.net_disbursed != null && (
            <ResultBanner tone="good">Net received {inrUsd(frDisc.net_disbursed)} — pre-shipment loan auto-settled.</ResultBanner>
          )}
        </ActionCard>
      </motion.div>
    </AppShell>
  );
}
