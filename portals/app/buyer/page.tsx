'use client';
import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { AppShell } from '@/components/AppShell';
import { Pipeline, type Stage } from '@/components/Pipeline';
import { ActionButton, ActionCard, Field, inputCls, inrUsd, usd } from '@/components/ui';
import { DocButton } from '@/components/DocViewer';
import { DocUpload } from '@/components/DocUpload';
import { PageHeader, EmptyDeal, ResultBanner, UploadChip, MatchAlert } from '@/components/workspace';
import { apiCall, apiGet, apiSeq, parseFile } from '@/lib/api';
import { ORG, useDeal } from '@/lib/deal';
import { escrowUsd } from '@/lib/amounts';
import { fadeUp, stagger } from '@/lib/motion';
import { IconDoc, IconTruck, IconReceipt, IconShield, IconCheck, IconArrowRight, IconCoins } from '@/components/icons';
import { BANK_ACCOUNTS, modeFor } from '@/lib/banks';
import type { BankPayment, Escrow, GRN, Invoice, PurchaseOrder } from '@/lib/types';

export default function BuyerPage() {
  const { code, ids } = useDeal();
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [grn, setGrn] = useState<GRN | null>(null);
  const [inv, setInv] = useState<Invoice | null>(null);
  const [esc, setEsc] = useState<Escrow | null>(null);
  // Settlement rail: on-chain escrow (USDC) or the off-chain bank rail (INR).
  const [rail, setRail] = useState<'escrow' | 'bank'>('escrow');
  const [pay, setPay] = useState<BankPayment | null>(null);
  const bene = BANK_ACCOUNTS[ORG.lender];
  const [beneName, setBeneName] = useState(bene.beneficiary_name);
  const [acctNo, setAcctNo] = useState(bene.account_number);
  const [ifsc, setIfsc] = useState(bene.ifsc);
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
    setParseNote(r.found.length ? `Auto-filled from ${file.name}: ${r.found.join(', ')}. Review, then create the PO.` : `Read ${file.name} but found no fields — enter values manually.`);
  }

  // GRN is also the buyer's document — enter the received qty, or upload & parse it.
  const [grnQty, setGrnQty] = useState<number | null>(null);
  const [grnDocHash, setGrnDocHash] = useState<string | null>(null);
  const [grnDocName, setGrnDocName] = useState<string | null>(null);
  const [grnParsing, setGrnParsing] = useState(false);
  const [grnNote, setGrnNote] = useState<string | null>(null);

  async function parseGrn(file: File) {
    setGrnParsing(true); setGrnNote(null);
    const r = await parseFile(file);
    setGrnParsing(false);
    if (!r) { setGrnNote('Could not read that document.'); return; }
    if (r.fields.quantity) setGrnQty(r.fields.quantity);
    setGrnDocHash(r.doc_hash); setGrnDocName(file.name);
    setGrnNote(r.fields.quantity ? `Received qty ${r.fields.quantity.toLocaleString('en-IN')} read from ${file.name}. Review, then record.` : `Read ${file.name} but no quantity found — check it below.`);
  }

  const refresh = useCallback(async () => {
    if (!ids) return;
    const [p, g, i, e, bp] = await Promise.all([
      apiGet<PurchaseOrder>(`/api/trade-docs/purchase-orders/${ids.po}`),
      apiGet<GRN>(`/api/trade-docs/grn/${ids.grn}`),
      apiGet<Invoice>(`/api/trade-docs/invoices/${ids.inv}`),
      apiGet<Escrow>(`/api/escrow/instructions/${ids.esc}`),
      apiGet<BankPayment>(`/api/payments/${ids.pay}`),
    ]);
    setPo(p); setGrn(g); setInv(i); setEsc(e); setPay(bp);
  }, [ids]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  if (!code || !ids) return <AppShell active="Buyer"><EmptyDeal /></AppShell>;

  const invReady = inv?.status === 'Approved' || inv?.status === 'Assigned';
  const effGrnQty = grnQty ?? po?.quantity ?? qty;
  const escInvAmount = inv?.amount ?? poAmount;
  const escInvQty = inv?.quantity ?? qty;
  const escUsd = escrowUsd(escInvAmount);
  const released = esc?.status === 'Released';

  const stages: Stage[] = [
    { label: 'Order', state: po ? 'done' : 'active' },
    { label: 'Delivery', state: grn ? 'done' : po ? 'active' : 'todo' },
    { label: 'Invoice', state: invReady ? 'done' : inv?.status === 'Matched' ? 'active' : 'todo' },
    { label: 'Escrow', state: (esc && esc.status !== 'None') ? 'done' : invReady ? 'active' : 'todo' },
    { label: 'Released', state: released ? 'done' : esc?.status === 'Funded' ? 'active' : 'todo' },
  ];

  return (
    <AppShell active="Buyer">
      <PageHeader
        title="Buyer workspace"
        subtitle="Issue the purchase order, confirm delivery, approve the invoice, and fund the escrow that pays the beneficiary."
      />
      <div className="mb-6"><Pipeline stages={stages} /></div>

      <motion.div variants={stagger} initial="hidden" animate="show" className="grid gap-4">
        {/* PO */}
        <ActionCard
          icon={<IconDoc size={20} />}
          title="Purchase Order"
          desc="Raise the order to your supplier, type the details or upload a PO to parse them."
          status={po?.status}
          done={!!po}
        >
          {po ? (
            <p className="text-sm text-slate-600">
              <span className="font-semibold text-ink">{po.quantity?.toLocaleString('en-IN')} × {po.item_description}</span> = {inrUsd(po.gross_value)}.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Item"><input value={item} onChange={(e) => setItem(e.target.value)} className={inputCls} /></Field>
                <Field label="Quantity"><input type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} className={`${inputCls} tnum`} /></Field>
                <Field label="Price / unit (₹)"><input type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} className={`${inputCls} tnum`} /></Field>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-surface px-4 py-2.5">
                <span className="text-xs font-medium text-slate-500">Order value</span>
                <span className="tnum text-sm font-bold text-ink">{inrUsd(poAmount)}</span>
              </div>
              <UploadChip label={poDocName ? `Parsed: ${poDocName}` : 'Upload & parse PO'} busy={parsing} onFile={parsePo} />
              {parseNote && <p className="text-xs font-medium text-emerald-600">{parseNote}</p>}
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <ActionButton label="Create PO" icon={<IconDoc size={16} />} disabled={!!po || !(poAmount > 0)}
              run={() => apiCall('POST', '/api/trade-docs/purchase-orders', {
                po_id: ids.po, buyer_id: ORG.buyer, supplier_id: ORG.supplier, currency: 'INR',
                gross_value: poAmount, quantity: qty, price_per_unit: price,
                item_description: item, delivery_terms: '45 days', payment_terms: '30 days',
                doc_hash: poDocHash ?? `po-${code}`,
              })} onDone={refresh} />
            <DocButton doc={po ? { kind: 'PO', data: po } : null} label="View PO" />
          </div>
        </ActionCard>

        {/* GRN */}
        <ActionCard
          icon={<IconTruck size={20} />}
          title="Goods Receipt (GRN)"
          desc="Record what actually arrived and passed inspection, enter the quantity or upload the GRN."
          status={grn?.status}
          done={!!grn}
        >
          {grn ? (
            <p className="text-sm text-slate-600">Received &amp; accepted <span className="font-semibold text-ink">{grn.received_qty?.toLocaleString('en-IN')} units</span>.</p>
          ) : (
            <div className="space-y-3">
              <div className="max-w-[12rem]">
                <Field label="Received quantity"><input type="number" value={effGrnQty} onChange={(e) => setGrnQty(Number(e.target.value))} className={`${inputCls} tnum`} /></Field>
              </div>
              <div className="flex flex-wrap gap-2">
                <DocUpload label="Attach GRN document" onUploaded={(h, n) => { setGrnDocHash(h); setGrnDocName(n); }} />
                <UploadChip label={grnDocName ? `Parsed: ${grnDocName}` : 'Upload & parse GRN'} busy={grnParsing} onFile={parseGrn} />
              </div>
              {grnNote && <p className="text-xs font-medium text-emerald-600">{grnNote}</p>}
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <ActionButton label="Record & Accept GRN" icon={<IconTruck size={16} />}
              disabled={!!grn || !po || (po.status !== 'Acknowledged' && po.status !== 'Locked') || !(effGrnQty > 0)}
              run={() => apiSeq([
                () => apiCall('POST', '/api/trade-docs/grn', { grn_id: ids.grn, po_id: ids.po, received_qty: effGrnQty, doc_hash: grnDocHash ?? undefined }),
                () => apiCall('PUT', `/api/trade-docs/grn/${ids.grn}/accept`),
              ])} onDone={refresh} />
            <DocButton doc={grn ? { kind: 'GRN', data: grn } : null} label="View GRN" />
          </div>
        </ActionCard>

        {/* Approve invoice */}
        <ActionCard
          icon={<IconReceipt size={20} />}
          title="Approve Invoice"
          desc={<>Approve the supplier&apos;s invoice ({inv ? inrUsd(inv.amount) : 'once raised'}) after the 3-way match passes.</>}
          status={inv?.status}
          done={invReady}
        >
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton label="Approve Invoice" icon={<IconCheck size={16} />} disabled={inv?.status !== 'Matched'}
              run={() => apiCall('PUT', `/api/trade-docs/invoices/${ids.inv}/approve`)} onDone={refresh} />
            <DocButton doc={inv ? { kind: 'INVOICE', data: inv } : null} label="View Invoice" />
          </div>
          {inv?.status === 'Submitted' && inv.match_result?.passed === false && <MatchAlert reasons={inv.match_result.reasons} />}
        </ActionCard>

        {/* Settlement rail — everything before this point is identical either way. */}
        <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white p-4 shadow-card">
          <span className="text-sm font-semibold text-ink">Settlement rail</span>
          <div className="inline-flex rounded-xl border border-line bg-surface p-1">
            {([['escrow', 'On-chain escrow'], ['bank', 'Bank transfer']] as const).map(([key, label]) => (
              <button key={key} onClick={() => setRail(key)}
                className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${rail === key ? 'bg-ink text-white' : 'text-slate-500 hover:text-ink'}`}>
                {label}
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-500">
            {rail === 'escrow'
              ? `Programmable escrow on Polygon, settled in USDC (${usd(escUsd)}).`
              : `Off-chain NEFT/RTGS transfer, settled in rupees (₹${escInvAmount.toLocaleString('en-IN')}).`}
          </span>
        </motion.div>

        {/* Bank rail (off-chain) */}
        {rail === 'bank' && (
          <ActionCard
            icon={<IconCoins size={20} />}
            title={`Bank Transfer (${modeFor(escInvAmount)})`}
            desc={<>Pay ₹{escInvAmount.toLocaleString('en-IN')} to the lender&apos;s account. This leg settles off-chain — only the UTR comes back for reconciliation.</>}
            status={pay?.status}
            done={pay?.status === 'Credited'}
          >
            {pay ? (
              <div className="space-y-2 text-sm text-slate-600">
                <div className="rounded-xl bg-surface px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-500">UTR</span>
                    <span className="break-all font-mono text-sm font-semibold text-ink">{pay.utr}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                    <span>{pay.mode} · {pay.beneficiary_name} · {pay.account_number} · {pay.ifsc}</span>
                    <span className="tnum font-semibold text-ink">₹{pay.amount_inr.toLocaleString('en-IN')}</span>
                  </div>
                </div>
                {pay.status === 'Initiated'
                  ? <p className="text-xs text-slate-500">Awaiting the beneficiary to confirm the credit (Lender workspace).</p>
                  : <ResultBanner tone="good">Credited to the lender · UTR {pay.utr}</ResultBanner>}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Beneficiary name"><input value={beneName} onChange={(e) => setBeneName(e.target.value)} className={inputCls} /></Field>
                  <Field label="Account number"><input value={acctNo} onChange={(e) => setAcctNo(e.target.value)} className={`${inputCls} tnum`} /></Field>
                  <Field label="IFSC"><input value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase())} className={inputCls} /></Field>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-surface px-4 py-2.5">
                  <span className="text-xs font-medium text-slate-500">Amount · {modeFor(escInvAmount)} (auto-selected by value)</span>
                  <span className="tnum text-sm font-bold text-ink">₹{escInvAmount.toLocaleString('en-IN')}</span>
                </div>
              </div>
            )}
            {!pay && (
              <div className="mt-4">
                <ActionButton label="Initiate Transfer" icon={<IconCoins size={16} />} disabled={!invReady}
                  run={() => apiCall('POST', '/api/payments', {
                    payment_id: ids.pay, payer_org_id: ORG.buyer, beneficiary_org_id: ORG.lender,
                    beneficiary_name: beneName, account_number: acctNo, ifsc,
                    amount_inr: escInvAmount, linked_invoice_id: ids.inv,
                  })} onDone={refresh} />
              </div>
            )}
          </ActionCard>
        )}

        {rail === 'escrow' && (<>
        {/* Escrow */}
        <ActionCard
          icon={<IconShield size={20} />}
          title="Create & Fund Escrow"
          desc={<>Deposit {usd(escUsd)} into a programmable escrow with the lender as beneficiary.</>}
          status={esc && esc.status !== 'None' ? esc.status : undefined}
          done={!!esc && ['Funded', 'Released'].includes(esc.status)}
        >
          <ActionButton label="Create & Fund Escrow" icon={<IconShield size={16} />} disabled={!invReady || (!!esc && esc.status !== 'None')}
            run={() => apiSeq([
              () => apiCall('POST', '/api/trade-docs/invoices', { invoice_id: ids.escInv, supplier_id: ORG.supplier, buyer_id: ORG.buyer, po_id: ids.po, grn_id: ids.grn, amount: escInvAmount, quantity: escInvQty, currency: 'INR', due_date: '2024-12-31', doc_hash: `escinv-${code}` }),
              () => apiCall('PUT', `/api/trade-docs/invoices/${ids.escInv}/match`),
              () => apiCall('POST', '/api/escrow/instructions', { escrow_payment_id: ids.esc, buyer_org_id: ORG.buyer, beneficiary_org_id: ORG.lender, linked_invoice_id: ids.escInv, amount_usd: escUsd }),
              () => apiCall('POST', `/api/escrow/instructions/${ids.esc}/fund`),
            ])} onDone={refresh} />
        </ActionCard>

        {/* Release */}
        <ActionCard
          icon={<IconArrowRight size={20} />}
          title="Final Approval → Auto-Release"
          desc="Your final approval flips the on-chain condition; the escrow releases to the lender across chains."
          status={esc?.status}
          done={released}
        >
          <ActionButton label="Approve & Release" icon={<IconCheck size={16} />} disabled={esc?.status !== 'Funded'}
            run={() => apiCall('PUT', `/api/trade-docs/invoices/${ids.escInv}/approve`)} onDone={refresh} />
          {released && <ResultBanner tone="good">Released {usd(escUsd)} to the lender.</ResultBanner>}
        </ActionCard>

        {/* Refund */}
        <ActionCard
          icon={<IconShield size={20} />}
          title="Refund (sad path)"
          desc="If the deal is cancelled before release, the escrow refunds the buyer (Rule-0C)."
          status={esc?.status === 'Refunded' ? 'Refunded' : undefined}
          done={esc?.status === 'Refunded'}
        >
          <ActionButton label="Refund This Escrow" variant="ghost" disabled={esc?.status !== 'Funded'}
            run={() => apiCall('POST', `/api/escrow/instructions/${ids.esc}/refund`)} onDone={refresh} />
          {esc?.status === 'Refunded' && <ResultBanner tone="bad">Refunded to buyer.</ResultBanner>}
        </ActionCard>
        </>)}
      </motion.div>
    </AppShell>
  );
}
