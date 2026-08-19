'use client';
import { ChangeEvent, ReactNode, useState } from 'react';
import { ApiResult, parseFile, ParseResult } from '@/lib/api';

export interface Confirmed { amount: number; quantity: number; due_date?: string }

// Upload a document → extract fields (self-contained) → show an editable confirm
// panel (fields marked 'from document' if auto-extracted, else 'default') →
// the caller creates the entity with the confirmed values + the stored doc hash.
export function ParseImport({
  label, showDueDate, defaults, onSubmit, onDone, disabled,
}: {
  label: string;
  showDueDate?: boolean;
  defaults: { amount: number; quantity: number; due_date?: string };
  onSubmit: (c: Confirmed, docHash: string) => Promise<ApiResult>;
  onDone?: () => void;
  disabled?: boolean;
}) {
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [fileName, setFileName] = useState('');
  const [amount, setAmount] = useState(defaults.amount);
  const [quantity, setQuantity] = useState(defaults.quantity);
  const [dueDate, setDueDate] = useState(defaults.due_date ?? '2024-12-31');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setParsing(true); setErr(null); setFileName(file.name);
    const r = await parseFile(file);
    setParsing(false);
    if (!r) { setErr('Could not read the document'); return; }
    if (r.fields.amount) setAmount(r.fields.amount);
    if (r.fields.quantity) setQuantity(r.fields.quantity);
    if (r.fields.due_date) setDueDate(r.fields.due_date);
    setResult(r);
  }

  async function confirm() {
    if (!result) return;
    setBusy(true); setErr(null);
    const res = await onSubmit({ amount, quantity, due_date: dueDate }, result.doc_hash);
    setBusy(false);
    if (!res.ok) setErr(res.error?.message ?? 'Failed');
    else { setResult(null); onDone?.(); }
  }

  const fromDoc = (f: string) => result?.found.includes(f);

  return (
    <div className="mt-2">
      <label className={`inline-flex items-center gap-1 rounded-lg border border-dashed px-2.5 py-1 text-xs font-semibold ${disabled ? 'cursor-not-allowed border-slate-200 text-slate-300' : 'cursor-pointer border-indigo-300 text-indigo-600 hover:bg-indigo-50'}`}>
        🔍 {label}
        <input type="file" className="hidden" disabled={disabled} onChange={onFile} accept=".pdf,.txt,.png,.jpg,.jpeg" />
      </label>
      {parsing && <span className="ml-2 text-xs text-slate-400">reading document…</span>}
      {err && !result && <p className="mt-1 text-xs text-rose-600">{err}</p>}

      {result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setResult(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800">Confirm extracted details</h3>
              <button onClick={() => setResult(null)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>
            <p className="mb-3 text-xs text-slate-500">
              From <span className="font-mono">{fileName}</span>. Review and edit before submitting —
              fields marked <span className="font-semibold text-emerald-600">from document</span> were auto-extracted, the rest use defaults.
            </p>
            <Row label="Amount (₹)" fromDoc={fromDoc('amount')}>
              <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="w-full rounded border border-slate-300 px-2 py-1 text-sm" />
            </Row>
            <Row label="Quantity" fromDoc={fromDoc('quantity')}>
              <input type="number" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} className="w-full rounded border border-slate-300 px-2 py-1 text-sm" />
            </Row>
            {showDueDate && (
              <Row label="Due date" fromDoc={fromDoc('due_date')}>
                <input type="text" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1 text-sm" />
              </Row>
            )}
            {(result.fields.invoice_number || result.fields.po_number) && (
              <p className="mt-2 text-xs text-slate-400">Reference detected in document: {result.fields.invoice_number || result.fields.po_number}</p>
            )}
            {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
            <button onClick={confirm} disabled={busy}
              className="mt-4 w-full rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
              {busy ? 'Submitting…' : 'Confirm & Create'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, fromDoc, children }: { label: string; fromDoc?: boolean; children: ReactNode }) {
  return (
    <div className="mb-2">
      <div className="mb-0.5 flex items-center gap-2 text-xs">
        <span className="text-slate-500">{label}</span>
        {fromDoc
          ? <span className="rounded bg-emerald-50 px-1.5 text-[10px] font-semibold text-emerald-600">from document</span>
          : <span className="rounded bg-slate-100 px-1.5 text-[10px] text-slate-400">default</span>}
      </div>
      {children}
    </div>
  );
}
