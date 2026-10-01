import * as chai from 'chai';
import sinon from 'sinon';
import { FinanceChaincode } from './finance.chaincode';
import { approvalStub } from './approval-stub';

const { expect } = chai;

// ─── Event payload contract (PRIVACY-DESIGN.md §3.2) ──────────────────────────
// Financing terms are the most commercially sensitive data on the platform — a
// competing lender who learns a rival's discount rate has learned its pricing.
// Events reach every channel member and are immutable, so nothing commercial may
// leave through one. Whitelist, not blacklist: an unlisted key is a failure.
const ALLOWED_KEYS = new Set([
  'request_id', 'asset_id',          // entity identifiers
  'asset_type', 'product_type',      // structural classifiers, not figures
  'lender_id',                       // party org id
  'status',                          // state-machine position
  'failed_checks',                   // eligibility check names, never the reasons text
  'tx_type', 'entity_id', 'org_id',  // maker-checker: WHAT needs approving, never its value
]);

function collectKeys(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) collectKeys(v, into);
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      into.push(k);
      collectKeys(v, into);
    }
  }
  return into;
}

function makeCtx(
  state: Record<string, Buffer> = {},
  cross: Record<string, unknown> = {},
  opts: { user?: string; thresholds?: Record<string, number>; priv?: Record<string, Buffer> } = {},
) {
  // The maker-checker gate (BR-09) reads onboarding-cc for the approving org on
  // every gated write. Thresholds default high here — these suites are about
  // the financing rules, not the signatures; maker-checker.test.ts drives those.
  // The approving org defaults to the caller's own, since the gate admits only
  // that organisation's users. These suites call as the platform throughout.
  const approvals = approvalStub(state, () => 'PlatformMSP', { thresholds: opts.thresholds });
  const invokeChaincode = sinon.stub().callsFake(async (ccName: string, args: string[]) => {
    if (ccName === 'onboarding-cc') return approvals.invokeChaincode(ccName, args);
    const fn = args[0];
    if (Object.prototype.hasOwnProperty.call(cross, fn)) {
      return { status: 200, payload: Buffer.from(JSON.stringify(cross[fn])) };
    }
    return { status: 200, payload: Buffer.from('') };
  });
  const priv: Record<string, Buffer> = opts.priv ?? {};
  const transientMap = new Map<string, Buffer>();
  const stub = {
    getPrivateData: sinon.stub().callsFake(async (_c: string, key: string) => priv[key] ?? Buffer.alloc(0)),
    putPrivateData: sinon.stub().callsFake(async (_c: string, key: string, val: Buffer) => { priv[key] = val; }),
    getTransient: sinon.stub().returns(transientMap),
    getState: sinon.stub().callsFake(async (key: string) => state[key] ?? Buffer.alloc(0)),
    putState: sinon.stub().callsFake(async (key: string, val: Buffer) => { state[key] = val; }),
    deleteState: sinon.stub().callsFake(async (key: string) => { delete state[key]; }),
    setEvent: sinon.stub(),
    getTxTimestamp: sinon.stub().returns({ seconds: { low: 1735689600 }, nanos: 0 }),
    ...approvals,
    invokeChaincode,
  };
  return { ctx: { stub, clientIdentity: {
      getMSPID: sinon.stub().returns('PlatformMSP'),
      getID: sinon.stub().returns(opts.user ?? 'x509::CN=platform-user'),
    },
    __private: priv,
    __setTransient: (v: unknown) => transientMap.set('payload', Buffer.from(JSON.stringify(v))) } as any };
}

function emitted(ctx: any): { name: string; payload: Record<string, unknown> }[] {
  return ctx.stub.setEvent.getCalls().map((c: any) => ({
    name: c.args[0],
    payload: JSON.parse(Buffer.from(c.args[1]).toString()),
  }));
}

function assertNoCommercialData(events: { name: string; payload: Record<string, unknown> }[]) {
  expect(events.length, 'flow emitted no events — the guard would vacuously pass').to.be.greaterThan(0);
  for (const { name, payload } of events) {
    for (const key of collectKeys(payload)) {
      expect(
        ALLOWED_KEYS.has(key),
        `event '${name}' payload carries disallowed key '${key}' — see PRIVACY-DESIGN.md §3.2`,
      ).to.equal(true);
    }
  }
}

const disc = {
  request_id: 'FR-DISC-001',
  product_type: 'InvoiceDiscounting',
  asset_type: 'Invoice',
  asset_id: 'BS-INV-2024-1102',
  requestor_org_id: 'bharat-001',
  lender_id: 'hdfc-001',
  lender_msp: 'LenderMSP',
  requested_amount: 24255000,
};

// An invoice that passes Rule-01 — Approved, 3-way match passed.
const financeableInvoice = {
  invoice_id: disc.asset_id,
  status: 'Approved',
  match_result: { passed: true },
};

const cc = new FinanceChaincode();

// ─── Private-data test helpers (PRIVACY-DESIGN.md §2.1) ──────────────────────
// Financing terms travel as transient data; identifiers and state as arguments.
const FR_PARTIES = ['SupplierMSP', 'LenderMSP', 'PlatformMSP'];
const FR_SALT = '0123456789abcdef0123456789abcdef';

async function createFR(ctx: any, fr: any) {
  ctx.__setTransient({ requested_amount: fr.requested_amount, discount_rate: fr.discount_rate, salt: FR_SALT });
  const { requested_amount, discount_rate, ...index } = fr;
  return cc.createFinanceRequest(ctx, JSON.stringify({ ...index, party_msps: FR_PARTIES }));
}

async function quote(ctx: any, id: string, q: Record<string, unknown>) {
  ctx.__setTransient({ ...q, salt: FR_SALT });
  return cc.submitQuote(ctx, id);
}

async function approve(ctx: any, id: string, amount: number) {
  ctx.__setTransient({ approved_amount: amount });
  return cc.approveFinancing(ctx, id);
}

async function disburse(ctx: any, id: string, ref: string, net?: number) {
  ctx.__setTransient(net === undefined ? {} : { net_disbursed: net });
  return cc.disburseFunds(ctx, id, ref);
}

async function repay(ctx: any, id: string, amount: number, ref: string) {
  ctx.__setTransient({ repayment_amount: amount });
  return cc.recordRepayment(ctx, id, ref);
}

describe('finance-cc event payload contract', () => {

  it('emits no commercial data across the full financing lifecycle', async () => {
    const { ctx } = makeCtx({}, { getInvoice: financeableInvoice });
    await createFR(ctx, disc);
    await cc.validateEligibility(ctx, disc.request_id);
    await cc.assignLender(ctx, disc.request_id, 'hdfc-001');
    await quote(ctx, disc.request_id, {
      advance_rate: 0.98, discount_rate: 0.02, interest_rate: 0.12, tenor_days: 60,
    });
    await approve(ctx, disc.request_id, 24255000);
    await cc.acceptOffer(ctx, disc.request_id);
    await disburse(ctx, disc.request_id, 'NEFT-REF-1', 12077466);
    await repay(ctx, disc.request_id, 24750000, 'UTR-1');
    assertNoCommercialData(emitted(ctx));
  });

  // The gated path emits three further events, and the figure under approval is
  // above a threshold by definition — the likeliest place for an amount to be
  // attached "so the queue can show it".
  it('emits no commercial data when an approval is parked, granted or refused', async () => {
    const state: Record<string, Buffer> = {};
    const priv: Record<string, Buffer> = {};
    const gated = { FINANCE_APPROVE: 5000000 };
    const desk = (user: string) =>
      makeCtx(state, { getInvoice: financeableInvoice }, { user, thresholds: gated, priv }).ctx;
    const amit = desk('id:amit');
    const nandita = desk('id:nandita');

    await createFR(amit, disc);
    await cc.validateEligibility(amit, disc.request_id);
    await cc.assignLender(amit, disc.request_id, 'hdfc-001');
    await quote(amit, disc.request_id, { discount_rate: 0.02, tenor_days: 60 });
    await approve(amit, disc.request_id, 24255000);
    expect(emitted(amit).map((e) => e.name),
      'the gate must actually fire for this guard to mean anything')
      .to.include('ApprovalRequested');

    await cc.approveFinancing(nandita, disc.request_id);
    expect(emitted(nandita).map((e) => e.name)).to.include('ApprovalGranted');
    assertNoCommercialData([...emitted(amit), ...emitted(nandita)]);

    // And the refusal path, on a second request, whose reason is free text a
    // human wrote and can name any figure.
    const other = { ...disc, request_id: 'FR-DISC-002', asset_id: 'BS-INV-2024-1103' };
    const maker = desk('id:amit');
    await createFR(maker, other);
    await cc.validateEligibility(maker, other.request_id);
    await cc.assignLender(maker, other.request_id, 'hdfc-001');
    await quote(maker, other.request_id, { discount_rate: 0.02, tenor_days: 60 });
    await approve(maker, other.request_id, 17400000);

    const refuser = desk('id:nandita');
    await cc.rejectApproval(refuser, 'FINANCE_APPROVE', other.request_id,
      'exposure over 2.4cr on this buyer');
    expect(emitted(refuser).map((e) => e.name)).to.include('ApprovalRejected');
    assertNoCommercialData([...emitted(maker), ...emitted(refuser)]);
  });

  // Eligibility failure builds free-text reasons. They carry ids today, but free
  // text in an immutable channel-wide event is exactly the surface §3.2 closes.
  it('emits no commercial data when eligibility FAILS', async () => {
    const { ctx } = makeCtx({}, { getInvoice: { invoice_id: disc.asset_id, status: 'Submitted' } });
    await createFR(ctx, disc);
    await cc.validateEligibility(ctx, disc.request_id).catch(() => { /* throws by design */ });

    const names = emitted(ctx).map((e) => e.name);
    expect(names, 'eligibility must actually fail for this guard to mean anything')
      .to.include('FinanceEligibilityFailed');
    assertNoCommercialData(emitted(ctx));
  });
});
