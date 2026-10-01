'use client';
import { useCallback, useEffect, useState } from 'react';
import { ActionCard, ActionButton, inrUsd, inputCls } from '@/components/ui';
import { IconCheck, IconShield } from '@/components/icons';
import { apiCallAs } from '@/lib/api';
import type { ApprovalRecord } from '@/lib/types';

// ─── The checker's worklist (BR-09, Rule-06) ─────────────────────────────────
// A transition above the organisation's threshold does not happen on the
// maker's call — it is parked, and lands here for a second person to sign.
//
// Countersigning is calling the SAME endpoint the maker called. The chaincode
// recognises the pending record, asserts the signer is a different user in the
// same organisation, and commits the figure the maker proposed — not one this
// screen could supply. So the queue needs no amount field, only the route.

const ROUTES: Record<string, { label: string; route: (id: string) => string }> = {
  PO_ISSUE: { label: 'Issue purchase order', route: (id) => `/api/trade-docs/purchase-orders/${id}/issue` },
  GRN_ACCEPT: { label: 'Accept goods receipt', route: (id) => `/api/trade-docs/grn/${id}/accept` },
  INVOICE_APPROVE: { label: 'Approve invoice', route: (id) => `/api/trade-docs/invoices/${id}/approve` },
  FINANCE_APPROVE: { label: 'Approve financing', route: (id) => `/api/finance/${id}/approve` },
};

export function ApprovalQueue({ checker, checkerName }: { checker: string; checkerName: string }) {
  const [items, setItems] = useState<ApprovalRecord[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    const r = await apiCallAs<ApprovalRecord[]>(checker, 'GET', '/api/approvals/pending');
    setItems(r.ok && Array.isArray(r.data) ? r.data : []);
  }, [checker]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <ActionCard
      icon={<IconShield size={20} />}
      title={`Approvals — ${checkerName}`}
      desc="Transitions above your organisation's threshold, waiting on a second signature. The maker cannot sign their own."
      status={items.length ? `${items.length} pending` : 'Clear'}
      done={items.length === 0}
    >
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing waiting on you.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((a) => {
            const key = `${a.tx_type}:${a.entity_id}`;
            const spec = ROUTES[a.tx_type];
            return (
              <li key={key} className="rounded-xl bg-surface px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">
                    {spec?.label ?? a.tx_type}
                  </span>
                  {a.amount !== undefined && (
                    <span className="tnum text-sm font-bold text-ink">{inrUsd(a.amount)}</span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  {a.entity_id}
                  {a.threshold !== undefined && ` · over your ${inrUsd(a.threshold)} limit`}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <ActionButton
                    label="Countersign"
                    icon={<IconCheck size={16} />}
                    disabled={!spec}
                    run={() => apiCallAs(checker, 'PUT', spec.route(a.entity_id))}
                    onDone={refresh}
                  />
                  <input
                    value={reasons[key] ?? ''}
                    onChange={(e) => setReasons({ ...reasons, [key]: e.target.value })}
                    placeholder="Reason, if refusing"
                    className={`${inputCls} max-w-[16rem]`}
                  />
                  <ActionButton
                    label="Refuse"
                    variant="ghost"
                    disabled={!(reasons[key] ?? '').trim()}
                    run={() => apiCallAs(
                      checker, 'POST',
                      `/api/approvals/${a.tx_type}/${a.entity_id}/reject`,
                      { reason: reasons[key] },
                    )}
                    onDone={refresh}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </ActionCard>
  );
}
