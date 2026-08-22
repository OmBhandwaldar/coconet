'use client';
import { ChangeEvent, useState } from 'react';
import { uploadFile } from '@/lib/api';
import { IconUpload } from '@/components/icons';

// Attach a real document file: uploads it to storage, gets back the on-chain
// fingerprint, and hands it up. If nothing is attached, the caller falls back
// to a placeholder hash so the demo still flows.
export function DocUpload({
  label, onUploaded, disabled,
}: {
  label: string;
  onUploaded: (hash: string, name: string) => void;
  disabled?: boolean;
}) {
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setErr(null);
    const hash = await uploadFile(file);
    setBusy(false);
    if (hash) { setName(file.name); onUploaded(hash, file.name); }
    else setErr('Upload failed');
  }

  return (
    <div className="inline-flex flex-col">
      <label className={`inline-flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-1.5 text-xs font-semibold transition ${disabled ? 'cursor-not-allowed border-line text-slate-300' : 'cursor-pointer border-line text-slate-600 hover:border-slate-300 hover:bg-surface'}`}>
        <IconUpload size={14} /> {name ? `Attached: ${name}` : label}
        <input type="file" className="hidden" disabled={disabled} onChange={onChange} accept=".pdf,.png,.jpg,.jpeg" />
      </label>
      {busy && <span className="mt-1 text-xs text-slate-400">uploading…</span>}
      {err && <p className="mt-1 text-xs text-rose-600">{err}</p>}
    </div>
  );
}
