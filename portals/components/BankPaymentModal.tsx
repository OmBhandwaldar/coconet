'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ActionButton, Field, inputCls } from '@/components/ui';
import { IconCheck, IconCoins } from '@/components/icons';
import { apiCall, apiGet, type ApiResult } from '@/lib/api';
import { modeFor } from '@/lib/banks';
import type { BankAccount, BankPayment, PaymentPurpose } from '@/lib/types';

// One modal for the whole bank leg: capture the beneficiary (first time only),
// initiate the transfer, then show the UTR. Rendered through a portal so it
// escapes the motion-transformed cards.
export function BankPaymentModal({
  open, onClose, title, purpose, paymentId, payerOrgId, beneficiaryOrgId,
  defaultAccount, amountInr, linkedInvoiceId, payment, onDone, onInitiated,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  purpose: PaymentPurpose;
  paymentId: string;
  payerOrgId: string;
  beneficiaryOrgId: string;
  defaultAccount: BankAccount;
  amountInr: number;
  linkedInvoiceId?: string;
  payment: BankPayment | null;
  onDone: () => void;
  onInitiated?: (p: BankPayment) => Promise<ApiResult> | void;
}) {
  const [mounted, setMounted] = useState(false);
  const [saved, setSaved] = useState<BankAccount | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(defaultAccount.beneficiary_name);
  const [acct, setAcct] = useState(defaultAccount.account_number);
  const [ifsc, setIfsc] = useState(defaultAccount.ifsc);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Look up whether this beneficiary's account was captured on an earlier leg.
  useEffect(() => {
    if (!open || payment) return;
    let cancelled = false;
    (async () => {
      const a = await apiGet<BankAccount>(`/api/payments/accounts/${beneficiaryOrgId}`);
      if (cancelled) return;
      setSaved(a);
      if (a) { setName(a.beneficiary_name); setAcct(a.account_number); setIfsc(a.ifsc); }
      setEditing(!a);
    })();
    return () => { cancelled = true; };
  }, [open, beneficiaryOrgId, payment]);

  const mode = modeFor(amountInr);
  const knownAccount = !!saved && !editing;

  const body = (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-6 shadow-elevated"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold tracking-tight text-ink">{title}</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Off-chain bank transfer · {mode} auto-selected by value
                </p>
              </div>
              <button onClick={onClose} aria-label="Close"
                className="rounded-lg p-1 text-slate-400 transition hover:bg-surface hover:text-slate-700">✕</button>
            </div>

            <div className="mb-4 flex items-center justify-between rounded-xl bg-surface px-4 py-3">
              <span className="text-xs font-medium text-slate-500">Amount</span>
              <span className="tnum text-lg font-bold text-ink">₹{amountInr.toLocaleString('en-IN')}</span>
            </div>

            {payment ? (
              <PaymentReceipt payment={payment} onDone={onDone} />
            ) : (
              <>
                {knownAccount ? (
                  <div className="rounded-xl border border-line bg-white px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Beneficiary (saved)</span>
                      <button onClick={() => setEditing(true)} className="text-xs font-semibold text-brand-600 hover:underline">Change</button>
                    </div>
                    <p className="mt-1 text-sm font-semibold text-ink">{saved!.beneficiary_name}</p>
                    <p className="text-xs text-slate-500">{saved!.account_number} · {saved!.ifsc}</p>
                  </div>
                ) : (
                  <div className="grid gap-3">
                    <Field label="Beneficiary name">
                      <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
                    </Field>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Account number">
                        <input value={acct} onChange={(e) => setAcct(e.target.value)} className={`${inputCls} tnum`} />
                      </Field>
                      <Field label="IFSC">
                        <input value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase())} className={inputCls} />
                      </Field>
                    </div>
                    <p className="text-xs text-slate-400">Saved for this party — later transfers won&apos;t ask again.</p>
                  </div>
                )}

                <div className="mt-5">
                  <ActionButton
                    label={`Initiate ${mode} Transfer`}
                    icon={<IconCoins size={16} />}
                    run={async () => {
                      const r = await apiCall<BankPayment>('POST', '/api/payments', {
                        payment_id: paymentId,
                        payer_org_id: payerOrgId,
                        beneficiary_org_id: beneficiaryOrgId,
                        beneficiary_name: knownAccount ? saved!.beneficiary_name : name,
                        account_number: knownAccount ? saved!.account_number : acct,
                        ifsc: knownAccount ? saved!.ifsc : ifsc,
                        amount_inr: amountInr,
                        purpose,
                        linked_invoice_id: linkedInvoiceId,
                      });
                      // Let the caller record the resulting UTR on-ledger.
                      if (r.ok && r.data && onInitiated) {
                        const follow = await onInitiated(r.data);
                        if (follow && !follow.ok) return follow;
                      }
                      return r;
                    }}
                    onDone={onDone}
                  />
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return mounted ? createPortal(body, document.body) : null;
}

function PaymentReceipt({ payment, onDone }: { payment: BankPayment; onDone: () => void }) {
  const credited = payment.status === 'Credited';
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-slate-500">UTR</span>
          <span className="break-all font-mono text-sm font-semibold text-ink">{payment.utr}</span>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {payment.mode} · {payment.beneficiary_name} · {payment.account_number} · {payment.ifsc}
        </p>
      </div>
      {credited ? (
        <p className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-3.5 py-2 text-sm font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
          <IconCheck size={16} /> Credited to the beneficiary
        </p>
      ) : (
        <p className="text-xs text-slate-500">Initiated — awaiting the beneficiary to confirm the credit.</p>
      )}
      <button onClick={onDone} className="w-full rounded-xl bg-ink px-3 py-2 text-sm font-semibold text-white transition hover:bg-ink-soft">
        Done
      </button>
    </div>
  );
}
