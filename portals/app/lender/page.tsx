'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { DealBar } from '@/components/DealBar';
import { ActionButton, StepCard, inrUsd, usd } from '@/components/ui';
import { DocButton } from '@/components/DocViewer';
import { apiCall, apiGet } from '@/lib/api';
import { ORG, useDeal } from '@/lib/deal';
import { AMT, escrowUsd } from '@/lib/amounts';
import type { Escrow, FinanceRequest, Invoice, PurchaseOrder } from '@/lib/types';

export default function LenderPage() {
  const { code, ids } = useDeal();
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [frPre, setFrPre] = useState<FinanceRequest | null>(null);
  const [frDisc, setFrDisc] = useState<FinanceRequest | null>(null);
  const [inv, setInv] = useState<Invoice | null>(null);
  const [esc, setEsc] = useState<Escrow | null>(null);

  const refresh = useCallback(async () => {
    if (!ids) return;
    const [p, fp, fd, i, e] = await Promise.all([
      apiGet<PurchaseOrder>(`/api/trade-docs/purchase-orders/${ids.po}`),
      apiGet<FinanceRequest>(`/api/finance/${ids.frPre}`),
      apiGet<FinanceRequest>(`/api/finance/${ids.frDisc}`),
      apiGet<Invoice>(`/api/trade-docs/invoices/${ids.inv}`),
      apiGet<Escrow>(`/api/escrow/instructions/${ids.esc}`),
    ]);
    setPo(p); setFrPre(fp); setFrDisc(fd); setInv(i); setEsc(e);
  }, [ids]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  // The lender sets its own quote (defaults seeded from config). Once a quote is
  // submitted, the stored terms on the request are the source of truth.
  const [advPct, setAdvPct] = useState(AMT.advanceRate * 100);
  const [intPct, setIntPct] = useState(AMT.interestRate * 100);
  const [tenor, setTenor] = useState(AMT.tenorDays);
  const [discPct, setDiscPct] = useState(AMT.discRate * 100);

  const effAdv = frPre?.advance_rate ?? advPct / 100;
  const effIntPct = frPre?.interest_rate != null ? frPre.interest_rate * 100 : intPct;
  const effTenor = frPre?.tenor_days ?? tenor;
  const effDiscPct = frDisc?.discount_rate != null ? frDisc.discount_rate * 100 : discPct;
  // Offered advance derives from the lender's advance rate × the PO value.
  const preShip = Math.round((po?.gross_value ?? AMT.poGross) * effAdv);
  const discAmt = Math.round((inv?.amount ?? AMT.invAmount) * (1 - effDiscPct / 100));

  if (!code || !ids) {
    return (
      <main>
        <DealBar active="Lender" />
        <div className="mx-auto max-w-2xl px-6 py-16 text-center text-slate-500">
          No active deal. Start one from the <Link href="/" className="text-brand underline">home page</Link>.
        </div>
      </main>
    );
  }

  return (
    <main>
      <DealBar active="Lender" />
      <div className="mx-auto max-w-2xl space-y-6 px-6 py-8">
        <h1 className="text-xl font-bold text-amber-700">Lender</h1>

        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-400">Pre-Shipment Finance</h2>
          <div className="space-y-4">
            <StepCard n={1} title="Validate Eligibility (Rule-01 + Rule-02)" status={frPre?.status}>
              Verify the PO on-chain and that it has no existing lien.
              <ActionButton label="Validate" disabled={frPre?.status !== 'Requested'}
                run={() => apiCall('PUT', `/api/finance/${ids.frPre}/validate-eligibility`)} onDone={refresh} />
              <DocButton doc={po ? { kind: 'PO', data: po } : null} label="View PO" />
            </StepCard>
            <StepCard n={2} title="Submit Quote" status={frPre?.status}>
              {frPre?.status === 'Under Review' ? (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <RateField label="Advance %" value={advPct} onChange={setAdvPct} />
                    <RateField label="Interest %" value={intPct} onChange={setIntPct} />
                    <RateField label="Tenor (days)" value={tenor} onChange={setTenor} step={1} />
                  </div>
                  <p className="mt-1 text-sm text-slate-700">Offer: <span className="font-semibold">{inrUsd(preShip)}</span> @ {intPct}% for {tenor} days.</p>
                </>
              ) : (
                <>Offer {inrUsd(preShip)} @ {effIntPct}% for {effTenor} days.</>
              )}
              <ActionButton label="Submit Quote" disabled={frPre?.status !== 'Under Review'}
                run={() => apiCall('PUT', `/api/finance/${ids.frPre}/quote`, { advance_rate: advPct / 100, interest_rate: intPct / 100, tenor_days: tenor })} onDone={refresh} />
            </StepCard>
            <StepCard n={3} title="Approve" status={frPre?.approved_amount ? 'Approved' : undefined}>
              Approve the advance amount ({inrUsd(preShip)}).
              <ActionButton label="Approve Finance" disabled={frPre?.status !== 'Offered'}
                run={() => apiCall('PUT', `/api/finance/${ids.frPre}/approve`, { approved_amount: preShip })} onDone={refresh} />
            </StepCard>
            <StepCard n={4} title="Disburse" status={frPre?.status}>
              After the supplier accepts, disburse the loan.
              <ActionButton label="Disburse Loan" disabled={frPre?.status !== 'Accepted'}
                run={() => apiCall('PUT', `/api/finance/${ids.frPre}/disburse`, { disbursement_ref: `NEFT-${code}` })} onDone={refresh} />
            </StepCard>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-400">Invoice Discounting</h2>
          <div className="space-y-4">
            <StepCard n={5} title="Validate Eligibility" status={frDisc?.status}>
              Verify the invoice is approved + 3-way matched, and not already financed.
              <ActionButton label="Validate" disabled={frDisc?.status !== 'Requested'}
                run={() => apiCall('PUT', `/api/finance/${ids.frDisc}/validate-eligibility`)} onDone={refresh} />
              <DocButton doc={inv ? { kind: 'INVOICE', data: inv } : null} label="View Invoice" />
            </StepCard>
            <StepCard n={6} title="Submit Discounting Quote" status={frDisc?.status}>
              {frDisc?.status === 'Under Review' ? (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <RateField label="Discount %" value={discPct} onChange={setDiscPct} />
                  </div>
                  <p className="mt-1 text-sm text-slate-700">Pay the supplier <span className="font-semibold">{inrUsd(discAmt)}</span> (discount {discPct}%).</p>
                </>
              ) : (
                <>Offer a {effDiscPct}% discount ({inrUsd(discAmt)}).</>
              )}
              <ActionButton label="Submit Quote" disabled={frDisc?.status !== 'Under Review'}
                run={() => apiCall('PUT', `/api/finance/${ids.frDisc}/quote`, { discount_rate: discPct / 100 })} onDone={refresh} />
            </StepCard>
            <StepCard n={7} title="Disburse with Net Settlement" status={frDisc?.status}>
              After the supplier accepts, pay the discounted value and auto-settle the pre-shipment loan.
              <ActionButton label="Disburse (Net Settlement)" disabled={frDisc?.status !== 'Accepted'}
                run={() => apiCall('PUT', `/api/finance/${ids.frDisc}/disburse`, { disbursement_ref: `DISC-${code}`, pre_shipment_request_id: ids.frPre })} onDone={refresh} />
            </StepCard>
            {inv?.assignment_status === 'Assigned' && (
              <p className="text-sm font-semibold text-violet-600">Invoice assigned to you — you now own the receivable.</p>
            )}
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-400">Escrow Collection</h2>
          <StepCard n={8} title="Receive Payment from Escrow" status={esc?.status}>
            When the buyer gives final approval, the escrow auto-releases to you across chains.
            {esc?.status === 'Released'
              ? <p className="mt-2 text-sm font-semibold text-emerald-600">Received {usd(escrowUsd(inv?.amount ?? AMT.invAmount))} from escrow ✓</p>
              : <p className="mt-2 text-xs text-slate-400">Waiting for release… (escrow: {esc?.status ?? 'not created'})</p>}
          </StepCard>
        </section>
      </div>
    </main>
  );
}

function RateField({ label, value, onChange, step = 0.5 }: { label: string; value: number; onChange: (n: number) => void; step?: number }) {
  return (
    <label className="text-xs text-slate-500">{label}
      <input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm text-slate-800" />
    </label>
  );
}
