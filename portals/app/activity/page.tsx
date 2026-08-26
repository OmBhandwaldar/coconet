'use client';
import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { AppShell } from '@/components/AppShell';
import { PageHeader } from '@/components/workspace';
import { fetchActivity } from '@/lib/api';
import { useDeal } from '@/lib/deal';
import { IconActivity, IconLink, IconShield } from '@/components/icons';
import type { ActivityEntry } from '@/lib/types';

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB');

const ACTOR_CLS: Record<string, string> = {
  Buyer: 'text-brand-700',
  Supplier: 'text-emerald-700',
  Lender: 'text-accent-dark',
  Platform: 'text-slate-600',
  System: 'text-slate-500',
};

export default function ActivityPage() {
  const { code } = useDeal();
  const [scope, setScope] = useState<'deal' | 'all'>('deal');
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  const dealFilter = scope === 'deal' ? code ?? undefined : undefined;

  const load = useCallback(async () => {
    // In "this deal" scope with no active deal, show nothing.
    if (scope === 'deal' && !code) { setEntries([]); setLoaded(true); return; }
    const r = await fetchActivity(dealFilter);
    setEntries(r.entries);
    setLoaded(true);
  }, [scope, code, dealFilter]);

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <AppShell active="Activity">
      <PageHeader
        title="Activity"
        subtitle="Every action on the deal, recorded on-chain — with the transaction id and block it was written in."
      />

      {/* scope toggle */}
      <div className="mb-5 inline-flex rounded-xl border border-line bg-white p-1 shadow-card">
        {(['deal', 'all'] as const).map((s) => (
          <button key={s} onClick={() => setScope(s)}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${
              scope === s ? 'bg-ink text-white' : 'text-slate-500 hover:text-ink'
            }`}>
            {s === 'deal' ? (code ? `This deal · ${code}` : 'This deal') : 'All deals'}
          </button>
        ))}
      </div>

      {!loaded ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : entries.length === 0 ? (
        <EmptyState hasDeal={!!code} scope={scope} />
      ) : (
        <div className="space-y-2">
          {entries.map((e) => <Row key={e.seq} e={e} />)}
        </div>
      )}
    </AppShell>
  );
}

function Row({ e }: { e: ActivityEntry }) {
  const fabric = e.chain === 'fabric';
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      className="flex items-start gap-3 rounded-xl border border-line bg-white p-3.5 shadow-card"
    >
      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${fabric ? 'bg-brand-50 text-brand-600' : 'bg-violet-50 text-violet-600'}`}>
        {fabric ? <IconShield size={16} /> : <IconLink size={16} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="truncate text-[0.95rem] font-semibold text-ink">{e.label}</p>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <time className="tnum text-xs text-slate-400">{fmtTime(e.ts)}</time>
            <span className={`rounded-lg px-2.5 py-1 text-[0.65rem] font-bold uppercase tracking-wider ${fabric ? 'bg-brand-50 text-brand-700' : 'bg-violet-100 text-violet-700'}`}>
              {fabric ? 'Fabric' : 'Polygon'}
            </span>
          </div>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {e.actor && <span className={`font-semibold ${ACTOR_CLS[e.actor] ?? 'text-slate-500'}`}>{e.actor}</span>}
          {e.entity_id && <span className="font-mono text-slate-500">{e.entity_id}</span>}
          {e.deal && <span className="text-slate-400">· {e.deal}</span>}
        </div>
        <p className="mt-1 text-[0.7rem] text-slate-400">
          tx <span className="break-all font-mono text-slate-500">{e.tx ?? '—'}</span>
        </p>
      </div>
    </motion.div>
  );
}

function EmptyState({ hasDeal, scope }: { hasDeal: boolean; scope: 'deal' | 'all' }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-white/60 py-20 text-center">
      <IconActivity size={28} className="text-slate-300" />
      <p className="mt-3 text-sm text-slate-500">
        {scope === 'deal' && !hasDeal
          ? 'No active deal — start one, then actions will appear here as they hit the chain.'
          : 'No on-chain activity yet. Drive a deal in the workspaces and it will show up here.'}
      </p>
    </div>
  );
}
