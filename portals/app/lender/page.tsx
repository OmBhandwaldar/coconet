'use client';
import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { AppShell } from '@/components/AppShell';
import { Pipeline, type Stage } from '@/components/Pipeline';
import { ActionButton, ActionCard, Field, inputCls, inrUsd, usd } from '@/components/ui';
import { DocButton } from '@/components/DocViewer';
import { PageHeader, EmptyDeal, ResultBanner } from '@/components/workspace';
import { apiCall, apiGet } from '@/lib/api';
import { useDeal } from '@/lib/deal';
import { AMT, escrowUsd } from '@/lib/amounts';
import { stagger } from '@/lib/motion';
import { IconFinance, IconLink, IconShield, IconCheck, IconCoins } from '@/components/icons';
import type { BankPayment, Escrow, FinanceRequest, Invoice, PurchaseOrder } from '@/lib/types';

function RateField({ label, value, onChange, step = 0.5, suffix }: { label: string; value: number; onChange: (n: number) => void; step?: number; suffix?: string }) {
  return (
    <Field label={label}>
      <div className="relative">
        <input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className={`${inputCls} tnum pr-8`} />
        {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">{suffix}</span>}
      </div>
    </Field>
  );
}

export default function LenderPage() {
  const { code, ids } = useDeal();
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [frPre, setFrPre] = useState<FinanceRequest | null>(null);
  const [frDisc, setFrDisc] = useState<FinanceRequest | null>(null);
  const [inv, setInv] = useState<Invoice | null>(null);
  const [esc, setEsc] = useState<Escrow | null>(null);
  const [pay, setPay] = useState<BankPayment | null>(null);

  const refresh = useCallback(async () => {
    if (!ids) return;
    const [p, fp, fd, i, e, bp] = await Promise.all([
      apiGet<PurchaseOrder>(`/api/trade-docs/purchase-orders/${ids.po}`),
      apiGet<FinanceRequest>(`/api/finance/${ids.frPre}`),
      apiGet<FinanceRequest>(`/api/finance/${ids.frDisc}`),
      apiGet<Invoice>(`/api/trade-docs/invoices/${ids.inv}`),
      apiGet<Escrow>(`/api/escrow/instructions/${ids.esc}`),
      apiGet<BankPayment>(`/api/payments/${ids.pay}`),
    ]);
    setPo(p); setFrPre(fp); setFrDisc(fd); setInv(i); setEsc(e); setPay(bp);
  }, [ids]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  // The lender sets its own quote (defaults seeded from config). Once submitted,
  // the stored terms on the request are the source of truth.
  const [advPct, setAdvPct] = useState(AMT.advanceRate * 100);
  const [intPct, setIntPct] = useState(AMT.interestRate * 100);
  const [tenor, setTenor] = useState(AMT.tenorDays);
  const [discPct, setDiscPct] = useState(AMT.discRate * 100);

  const effAdv = frPre?.advance_rate ?? advPct / 100;
  const effIntPct = frPre?.interest_rate != null ? frPre.interest_rate * 100 : intPct;
  const effTenor = frPre?.tenor_days ?? tenor;
  const effDiscPct = frDisc?.discount_rate != null ? frDisc.discount_rate * 100 : discPct;
  const preShip = Math.round((po?.gross_value ?? AMT.poGross) * effAdv);
  const discAmt = Math.round((inv?.amount ?? AMT.invAmount) * (1 - effDiscPct / 100));

  if (!code || !ids) return <AppShell active="Lender"><EmptyDeal /></AppShell>;

  const released = esc?.status === 'Released';
  const stages: Stage[] = [
    { label: 'Underwrite', state: frPre?.approved_amount ? 'done' : frPre ? 'active' : 'todo' },
    { label: 'Disburse', state: frPre?.status === 'Disbursed' ? 'done' : frPre?.status === 'Accepted' ? 'active' : 'todo' },
    { label: 'Discount', state: frDisc?.status === 'Disbursed' ? 'done' : frDisc ? 'active' : 'todo' },
    { label: 'Collect', state: released ? 'done' : esc?.status === 'Funded' ? 'active' : 'todo' },
  ];

  return (
    <AppShell active="Lender">
      <PageHeader
        title="Lender workspace"
        subtitle="Underwrite pre-shipment finance, set your own quote, discount the approved invoice with net settlement, and collect from escrow."
      />
      <div className="mb-6"><Pipeline stages={stages} /></div>

      <motion.div variants={stagger} initial="hidden" animate="show" className="grid gap-4">
        {/* Pre-shipment */}
        <ActionCard
          icon={<IconFinance size={20} />}
          title="Pre-Shipment Finance"
          desc="Validate eligibility (Rule-01 + Rule-02), quote your terms, approve and disburse."
          status={frPre?.status}
          done={frPre?.status === 'Disbursed'}
        >
          {frPre?.status === 'Under Review' && (
            <div className="mb-4 rounded-xl border border-line bg-surface p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <RateField label="Percentage" value={advPct} onChange={setAdvPct} suffix="%" />
                <RateField label="Interest" value={intPct} onChange={setIntPct} suffix="%" />
                <RateField label="Tenor" value={tenor} onChange={setTenor} step={1} suffix="d" />
              </div>
              <p className="mt-3 text-sm text-slate-600">Offer <span className="tnum font-bold text-ink">{inrUsd(preShip)}</span> @ {intPct}% for {tenor} days.</p>
            </div>
          )}
          {frPre && frPre.status !== 'Under Review' && frPre.status !== 'Requested' && (
            <p className="mb-3 text-sm text-slate-600">Terms: <span className="tnum font-semibold text-ink">{inrUsd(preShip)}</span> @ {effIntPct}% · {effTenor} days.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton label="Validate" variant="ghost" disabled={frPre?.status !== 'Requested'}
              run={() => apiCall('PUT', `/api/finance/${ids.frPre}/validate-eligibility`)} onDone={refresh} />
            <ActionButton label="Submit Quote" icon={<IconCoins size={16} />} disabled={frPre?.status !== 'Under Review'}
              run={() => apiCall('PUT', `/api/finance/${ids.frPre}/quote`, { advance_rate: advPct / 100, interest_rate: intPct / 100, tenor_days: tenor })} onDone={refresh} />
            <ActionButton label="Approve" disabled={frPre?.status !== 'Offered'}
              run={() => apiCall('PUT', `/api/finance/${ids.frPre}/approve`, { approved_amount: preShip })} onDone={refresh} />
            <ActionButton label="Disburse Loan" icon={<IconCheck size={16} />} disabled={frPre?.status !== 'Accepted'}
              run={() => apiCall('PUT', `/api/finance/${ids.frPre}/disburse`, { disbursement_ref: `NEFT-${code}` })} onDone={refresh} />
            <DocButton doc={po ? { kind: 'PO', data: po } : null} label="View PO" />
          </div>
        </ActionCard>

        {/* Discounting */}
        <ActionCard
          icon={<IconLink size={20} />}
          title="Invoice Discounting"
          desc="Validate the approved & matched invoice, quote a discount, then disburse with automatic net settlement of the pre-shipment loan."
          status={frDisc?.status}
          done={frDisc?.status === 'Disbursed'}
        >
          {frDisc?.status === 'Under Review' && (
            <div className="mb-4 rounded-xl border border-line bg-surface p-4">
              <div className="max-w-[10rem]"><RateField label="Discount" value={discPct} onChange={setDiscPct} suffix="%" /></div>
              <p className="mt-3 text-sm text-slate-600">Pay the supplier <span className="tnum font-bold text-ink">{inrUsd(discAmt)}</span> (discount {discPct}%).</p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton label="Validate" variant="ghost" disabled={frDisc?.status !== 'Requested'}
              run={() => apiCall('PUT', `/api/finance/${ids.frDisc}/validate-eligibility`)} onDone={refresh} />
            <ActionButton label="Submit Quote" icon={<IconCoins size={16} />} disabled={frDisc?.status !== 'Under Review'}
              run={() => apiCall('PUT', `/api/finance/${ids.frDisc}/quote`, { discount_rate: discPct / 100 })} onDone={refresh} />
            <ActionButton label="Disburse (Net Settlement)" icon={<IconCheck size={16} />} disabled={frDisc?.status !== 'Accepted'}
              run={() => apiCall('PUT', `/api/finance/${ids.frDisc}/disburse`, { disbursement_ref: `DISC-${code}`, pre_shipment_request_id: ids.frPre })} onDone={refresh} />
            <DocButton doc={inv ? { kind: 'INVOICE', data: inv } : null} label="View Invoice" />
          </div>
          {inv?.assignment_status === 'Assigned' && (
            <ResultBanner tone="special">Invoice assigned to you, you now own the receivable.</ResultBanner>
          )}
        </ActionCard>

        {/* Escrow collection */}
        <ActionCard
          icon={<IconShield size={20} />}
          title="Escrow Collection"
          desc="When the buyer gives final approval, the escrow auto-releases to you across chains."
          status={esc?.status}
          done={released}
        >
          {released
            ? <ResultBanner tone="good">Received {usd(escrowUsd(inv?.amount ?? AMT.invAmount))} from escrow.</ResultBanner>
            : <p className="text-sm text-slate-500">Waiting for release… (escrow: {esc?.status ?? 'not created'})</p>}
        </ActionCard>

        {/* Bank rail (off-chain) — only shown once the buyer has used it. */}
        {pay && (
          <ActionCard
            icon={<IconCoins size={20} />}
            title={`Bank Transfer (${pay.mode})`}
            desc={<>The buyer settled off-chain by {pay.mode}. Confirm the credit once it lands — this stands in for bank reconciliation.</>}
            status={pay.status}
            done={pay.status === 'Credited'}
          >
            <div className="rounded-xl bg-surface px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-500">UTR</span>
                <span className="break-all font-mono text-sm font-semibold text-ink">{pay.utr}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>{pay.beneficiary_name} · {pay.account_number} · {pay.ifsc}</span>
                <span className="tnum font-semibold text-ink">₹{pay.amount_inr.toLocaleString('en-IN')}</span>
              </div>
            </div>
            <div className="mt-4">
              <ActionButton label="Confirm Receipt" icon={<IconCheck size={16} />} disabled={pay.status === 'Credited'}
                run={() => apiCall('PUT', `/api/payments/${ids.pay}/confirm`)} onDone={refresh} />
            </div>
            {pay.status === 'Credited' && (
              <ResultBanner tone="good">₹{pay.amount_inr.toLocaleString('en-IN')} credited · UTR {pay.utr}</ResultBanner>
            )}
          </ActionCard>
        )}
      </motion.div>
    </AppShell>
  );
}
