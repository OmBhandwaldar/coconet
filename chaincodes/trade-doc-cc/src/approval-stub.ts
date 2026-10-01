import sinon from 'sinon';

// ─── Test support: the stub surface the maker-checker gate needs ─────────────
// Every write path now runs through the gate (BR-09), so every harness needs
// composite keys, a range query, a tx id and onboarding-cc's org record. This
// lives in one place so the four harnesses cannot drift apart on what a peer
// offers the gate.

export interface ApprovalStubOptions {
  /** Thresholds by tx type, as onboarding-cc would return them. */
  thresholds?: Record<string, number>;
  /** MSP of the organisation the gate will treat as the approver. */
  orgMsp?: string;
  /** MSPs entitled to read that org's thresholds — anyone else fails closed. */
  entitledMsps?: string[];
}

/**
 * A threshold high enough that nothing in a worked example reaches it, so a
 * harness that is not about maker-checker keeps its single-signature flow.
 * Tests that are about maker-checker set their own.
 */
export const UNGATED = 1e15;

export function approvalStub(
  state: Record<string, Buffer>,
  callerMsp: () => string,
  opts: ApprovalStubOptions = {},
) {
  // Defaults to the caller's own org: the gate admits only the approving
  // organisation's users, so a harness that is not about maker-checker needs
  // its caller to BE that organisation.
  const orgMsp = opts.orgMsp ?? callerMsp();
  const entitled = opts.entitledMsps ?? [orgMsp, 'PlatformMSP', 'SupplierMSP', 'LenderMSP'];
  const thresholds = opts.thresholds ?? {
    PO_ISSUE: UNGATED, GRN_ACCEPT: UNGATED, INVOICE_APPROVE: UNGATED, FINANCE_APPROVE: UNGATED,
  };

  return {
    getTxID: sinon.stub().returns('tx-test'),
    createCompositeKey: (obj: string, attrs: string[]) =>
      `\u0000${obj}\u0000${attrs.join('\u0000')}\u0000`,
    getStateByPartialCompositeKey: sinon.stub().callsFake(async (obj: string) => {
      const prefix = `\u0000${obj}\u0000`;
      const rows = Object.entries(state)
        .filter(([k]) => k.startsWith(prefix))
        .map(([key, value]) => ({ key, value }));
      let i = 0;
      return {
        next: async () => (i < rows.length ? { done: false, value: rows[i++] } : { done: true }),
        close: async () => undefined,
      };
    }),
    invokeChaincode: sinon.stub().callsFake(async (_cc: string, args: string[]) => {
      const [fn, orgId] = args;
      if (fn !== 'getOrganization') return { status: 200, payload: Buffer.from('') };
      return {
        status: 200,
        payload: Buffer.from(JSON.stringify({
          org_id: orgId,
          msp_id: orgMsp,
          status: 'Approved',
          // Absent for a caller that may not see them — which is itself the
          // access decision the gate reads (maker-checker.ts, approvingOrg).
          ...(entitled.includes(callerMsp()) ? { maker_checker_thresholds: thresholds } : {}),
        })),
      };
    }),
  };
}
