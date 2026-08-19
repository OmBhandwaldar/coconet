'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { DealBar } from '@/components/DealBar';
import { ActionButton, StepCard, inrUsd, usd } from '@/components/ui';
import { apiCall, apiGet } from '@/lib/api';
import { ORG, useDeal } from '@/lib/deal';
import { AMT } from '@/lib/amounts';
import type { Escrow, FinanceRequest, Invoice } from '@/lib/types';

export default function LenderPage() {
  const { code, ids } = useDeal();
  const [frPre, setFrPre] = useState<FinanceRequest | null>(null);
  const [frDisc, setFrDisc] = useState<FinanceRequest | null>(null);
  const [inv, setInv] = useState<Invoice | null>(null);
  const [esc, setEsc] = useState<Escrow | null>(null);

  const refresh = useCallback(async () => {
    if (!ids) return;
    setFrPre(await apiGet<FinanceRequest>(`/api/finance/${ids.frPre}`));
    setFrDisc(await apiGet<FinanceRequest>(`/api/finance/${ids.frDisc}`));
    setInv(await apiGet<Invoice>(`/api/trade-docs/invoices/${ids.inv}`));
    setEsc(await apiGet<Escrow>(`/api/escrow/instructions/${ids.esc}`));
  }, [ids]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

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
            </StepCard>
            <StepCard n={2} title="Submit Quote" status={frPre?.status}>
              Offer {inrUsd(AMT.preShip)} @ {(AMT.interestRate * 100).toFixed(0)}% for {AMT.tenorDays} days.
              <ActionButton label="Submit Quote" disabled={frPre?.status !== 'Under Review'}
                run={() => apiCall('PUT', `/api/finance/${ids.frPre}/quote`, { advance_rate: AMT.advanceRate, interest_rate: AMT.interestRate, tenor_days: AMT.tenorDays })} onDone={refresh} />
            </StepCard>
            <StepCard n={3} title="Approve" status={frPre?.approved_amount ? 'Approved' : undefined}>
              Approve the advance amount ({inrUsd(AMT.preShip)}).
              <ActionButton label="Approve Finance" disabled={frPre?.status !== 'Offered'}
                run={() => apiCall('PUT', `/api/finance/${ids.frPre}/approve`, { approved_amount: AMT.preShip })} onDone={refresh} />
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
            </StepCard>
            <StepCard n={6} title="Submit Discounting Quote" status={frDisc?.status}>
              Offer a {(AMT.discRate * 100).toFixed(0)}% discount ({inrUsd(AMT.discRequested)}).
              <ActionButton label="Submit Quote" disabled={frDisc?.status !== 'Under Review'}
                run={() => apiCall('PUT', `/api/finance/${ids.frDisc}/quote`, { discount_rate: AMT.discRate })} onDone={refresh} />
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
              ? <p className="mt-2 text-sm font-semibold text-emerald-600">Received {usd(AMT.escUsd)} from escrow ✓</p>
              : <p className="mt-2 text-xs text-slate-400">Waiting for release… (escrow: {esc?.status ?? 'not created'})</p>}
          </StepCard>
        </section>
      </div>
    </main>
  );
}
