import { Context, Contract, Info, Returns, Transaction } from 'fabric-contract-api';

export type OrgType = 'Buyer' | 'Supplier' | 'Lender' | 'Platform' | 'Auditor';
export type OrgStatus = 'Pending' | 'Approved' | 'Suspended' | 'Closed';
export type RiskTier = 'Prime' | 'Standard' | 'High-touch';

export interface Organization {
  // Identity
  org_id: string;
  legal_name: string;
  org_type: OrgType;
  msp_id: string;

  // Registration (India)
  registration_number: string;
  gstin: string;
  pan: string;
  country: string;

  // Contact
  contact_email: string;
  registered_address: string;

  // Profile (Stage 2 of onboarding — optional at create, fillable later)
  incorporation_year?: number;
  industry?: string;
  turnover_band?: string;
  employee_count?: number;

  // Banking (Stage 5 — tokenized reference, never raw account number)
  bank_account_ref?: string;

  // Lifecycle
  status: OrgStatus;
  roles: string[];
  kyb_verified: boolean;

  created_at: string;
  updated_at: string;
}

// ─── Private organisation data (PRIVACY-DESIGN.md §2.1) ──────────────────────
// Two fields are not network-wide facts. The risk tier is the platform's credit
// judgement of a member, and the maker-checker threshold is the amount that
// member approves on a single signature — published, it tells every counterparty
// how large a transaction it waves through unchecked.
//
// Block 1 removed both from event payloads for that reason; leaving them in
// channel state would simply move the leak, since any member's peer can read
// public state directly. Redacting them in the API is not a boundary.
export interface OrganizationPrivate {
  risk_tier?: RiskTier;
  // Per transaction type, the amount above which a checker signature is
  // required. Enforcement arrives in Block 5 (Rule-06).
  maker_checker_thresholds: Record<string, number>;
  salt: string;
}

export type OrganizationView = Organization & Partial<OrganizationPrivate>;

const ORG_TYPES: OrgType[] = ['Buyer', 'Supplier', 'Lender', 'Platform', 'Auditor'];
const RISK_TIERS: RiskTier[] = ['Prime', 'Standard', 'High-touch'];

// India-specific identifier formats
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9]{1}[A-Z]{1}[0-9A-Z]{1}$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Info({ title: 'OnboardingChaincode', description: 'FR-ONB-01 to FR-ONB-04' })
export class OnboardingChaincode extends Contract {

  // Deterministic timestamp from the transaction proposal — every endorsing
  // peer computes the same value, so the read/write sets stay identical.
  // Using `new Date()` here would cause ENDORSEMENT_POLICY_FAILURE on commit.
  private txTimestamp(ctx: Context): string {
    const ts = ctx.stub.getTxTimestamp();
    return new Date(ts.seconds.low * 1000 + Math.floor(ts.nanos / 1e6)).toISOString();
  }

  // ─── FR-ONB-01: Create organisation ──────────────────────────────────────
  @Transaction()
  async createOrganization(ctx: Context, orgJson: string): Promise<string> {
    const input = JSON.parse(orgJson) as Partial<Organization>;

    // Required fields
    if (!input.org_id) throw new Error('org_id is required');
    if (!input.legal_name) throw new Error('legal_name is required');
    if (!input.org_type) throw new Error('org_type is required');
    if (!input.msp_id) throw new Error('msp_id is required');
    if (!input.gstin) throw new Error('gstin is required');
    if (!input.pan) throw new Error('pan is required');
    if (!input.contact_email) throw new Error('contact_email is required');
    if (!input.registered_address) throw new Error('registered_address is required');
    if (!input.registration_number) throw new Error('registration_number is required');
    if (!input.country) throw new Error('country is required');

    // Format validation
    if (!ORG_TYPES.includes(input.org_type)) {
      throw new Error(`Invalid org_type: ${input.org_type}. Must be one of ${ORG_TYPES.join(', ')}`);
    }
    if (!GSTIN_REGEX.test(input.gstin)) throw new Error(`Invalid GSTIN format: ${input.gstin}`);
    if (!PAN_REGEX.test(input.pan)) throw new Error(`Invalid PAN format: ${input.pan}`);
    if (!EMAIL_REGEX.test(input.contact_email)) throw new Error(`Invalid contact_email: ${input.contact_email}`);

    const exists = await this.orgExists(ctx, input.org_id);
    if (exists) throw new Error(`Organization ${input.org_id} already exists`);

    const now = this.txTimestamp(ctx);
    const org: Organization = {
      org_id: input.org_id,
      legal_name: input.legal_name,
      org_type: input.org_type,
      msp_id: input.msp_id,
      registration_number: input.registration_number,
      gstin: input.gstin,
      pan: input.pan,
      country: input.country,
      contact_email: input.contact_email,
      registered_address: input.registered_address,
      incorporation_year: input.incorporation_year,
      industry: input.industry,
      turnover_band: input.turnover_band,
      employee_count: input.employee_count,
      bank_account_ref: input.bank_account_ref,
      status: 'Pending',
      roles: input.roles ?? [],
      kyb_verified: false,

      created_at: now,
      updated_at: now,
    };

    await ctx.stub.putState(this.orgKey(input.org_id), Buffer.from(JSON.stringify(org)));
    await this.putOrgPrivate(ctx, input.org_id, { maker_checker_thresholds: {}, salt: this.newSalt(ctx) });
    ctx.stub.setEvent('OrganizationCreated', Buffer.from(JSON.stringify({
      org_id: org.org_id,
      org_type: org.org_type,
      msp_id: org.msp_id,
    })));

    return JSON.stringify(org);
  }

  // ─── FR-ONB-02: Approve / Suspend org (BRD Rule maker-checker aware) ─────
  @Transaction()
  async updateOrganizationStatus(ctx: Context, orgId: string, newStatus: string): Promise<string> {
    const org = await this.getOrg(ctx, orgId);

    const allowed: Record<OrgStatus, OrgStatus[]> = {
      Pending: ['Approved', 'Closed'],
      Approved: ['Suspended', 'Closed'],
      Suspended: ['Approved', 'Closed'],
      Closed: [],
    };
    if (!allowed[org.status].includes(newStatus as OrgStatus)) {
      throw new Error(`Illegal transition ${org.status} → ${newStatus}`);
    }

    org.status = newStatus as OrgStatus;
    if (org.status === 'Approved') org.kyb_verified = true;
    org.updated_at = this.txTimestamp(ctx);

    await ctx.stub.putState(this.orgKey(orgId), Buffer.from(JSON.stringify(org)));
    ctx.stub.setEvent('OrganizationStatusUpdated', Buffer.from(JSON.stringify({ org_id: orgId, status: newStatus })));

    return JSON.stringify(org);
  }

  // ─── FR-ONB-03: Assign role ───────────────────────────────────────────────
  @Transaction()
  async assignRole(ctx: Context, orgId: string, role: string): Promise<string> {
    const org = await this.getOrg(ctx, orgId);
    if (org.status !== 'Approved') throw new Error(`Cannot assign role to org in status ${org.status}`);
    if (!org.roles.includes(role)) org.roles.push(role);
    org.updated_at = this.txTimestamp(ctx);

    await ctx.stub.putState(this.orgKey(orgId), Buffer.from(JSON.stringify(org)));
    ctx.stub.setEvent('RoleAssigned', Buffer.from(JSON.stringify({ org_id: orgId, role })));

    return JSON.stringify(org);
  }

  // ─── Stage 7: Risk tier assignment (Prime / Standard / High-touch) ───────
  @Transaction()
  async setRiskTier(ctx: Context, orgId: string, tier: string): Promise<string> {
    const org = await this.getOrg(ctx, orgId);
    if (org.status !== 'Approved') throw new Error(`Cannot set risk tier on org in status ${org.status}`);
    if (!RISK_TIERS.includes(tier as RiskTier)) {
      throw new Error(`Invalid risk_tier: ${tier}. Must be one of ${RISK_TIERS.join(', ')}`);
    }

    const priv = (await this.getOrgPrivate(ctx, orgId)) ?? { maker_checker_thresholds: {}, salt: this.newSalt(ctx) };
    priv.risk_tier = tier as RiskTier;
    await this.putOrgPrivate(ctx, orgId, priv);
    org.updated_at = this.txTimestamp(ctx);

    await ctx.stub.putState(this.orgKey(orgId), Buffer.from(JSON.stringify(org)));
    ctx.stub.setEvent('RiskTierAssigned', Buffer.from(JSON.stringify({ org_id: orgId, status: org.status })));

    return JSON.stringify({ ...org, ...priv });
  }

  // ─── BR-09 / Rule-06: Maker-checker thresholds (storage only — Ring 11 enforces) ──
  @Transaction()
  async setMakerCheckerThreshold(
    ctx: Context,
    orgId: string,
    txType: string,
    threshold: string,
  ): Promise<string> {
    const org = await this.getOrg(ctx, orgId);
    if (org.status !== 'Approved') {
      throw new Error(`Cannot set threshold on org in status ${org.status}`);
    }
    if (!txType) throw new Error('txType is required');
    const amount = Number(threshold);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`Invalid threshold: ${threshold}. Must be a non-negative number.`);
    }

    const priv = (await this.getOrgPrivate(ctx, orgId)) ?? { maker_checker_thresholds: {}, salt: this.newSalt(ctx) };
    priv.maker_checker_thresholds[txType] = amount;
    await this.putOrgPrivate(ctx, orgId, priv);
    org.updated_at = this.txTimestamp(ctx);

    await ctx.stub.putState(this.orgKey(orgId), Buffer.from(JSON.stringify(org)));
    ctx.stub.setEvent(
      'MakerCheckerThresholdSet',
      Buffer.from(JSON.stringify({ org_id: orgId, tx_type: txType })),
    );

    return JSON.stringify({ ...org, ...priv });
  }

  @Transaction(false)
  @Returns('string')
  async getMakerCheckerThreshold(ctx: Context, orgId: string, txType: string): Promise<string> {
    const org = await this.getOrg(ctx, orgId);
    if (!this.maySeeOrgPrivate(ctx, org)) {
      throw new Error(`${ctx.clientIdentity.getMSPID()} may not read ${orgId}'s maker-checker thresholds`);
    }
    const priv = await this.getOrgPrivate(ctx, orgId);
    const threshold = priv?.maker_checker_thresholds[txType] ?? 0;
    return JSON.stringify({ org_id: orgId, tx_type: txType, threshold });
  }

  // ─── FR-ONB-04: Read org ──────────────────────────────────────────────────
  @Transaction(false)
  @Returns('string')
  async getOrganization(ctx: Context, orgId: string): Promise<string> {
    const org = await this.getOrg(ctx, orgId);
    // Membership, type and MSP are network-wide facts; the tier and thresholds
    // are not. Everyone sees the former, only the platform and the org itself
    // see the latter.
    if (!this.maySeeOrgPrivate(ctx, org)) return JSON.stringify(org);
    const priv = await this.getOrgPrivate(ctx, orgId);
    return JSON.stringify({ ...org, ...(priv ?? {}) });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  // Canonical private payload lives in the platform org's implicit collection
  // (PRIVACY-DESIGN.md §2.2.1).
  private readonly PRIVATE_COLLECTION = '_implicit_org_PlatformMSP';

  private async putOrgPrivate(ctx: Context, orgId: string, value: OrganizationPrivate): Promise<void> {
    await ctx.stub.putPrivateData(this.PRIVATE_COLLECTION, this.orgKey(orgId), Buffer.from(JSON.stringify(value)));
  }

  private async getOrgPrivate(ctx: Context, orgId: string): Promise<OrganizationPrivate | null> {
    try {
      const data = await ctx.stub.getPrivateData(this.PRIVATE_COLLECTION, this.orgKey(orgId));
      if (!data || data.length === 0) return null;
      return JSON.parse(data.toString()) as OrganizationPrivate;
    } catch {
      return null; // not a collection member — the boundary working
    }
  }

  /** Platform, or the organisation itself, may see its tier and thresholds. */
  private maySeeOrgPrivate(ctx: Context, org: Organization): boolean {
    const caller = ctx.clientIdentity.getMSPID();
    return caller === 'PlatformMSP' || caller === org.msp_id;
  }

  /** Deterministic across endorsers — the tx id is the only entropy chaincode
   *  may safely use, since every endorser must compute the same value. */
  private newSalt(ctx: Context): string {
    return ctx.stub.getTxID();
  }

  private orgKey(orgId: string): string {
    return `ORG:${orgId}`;
  }

  private async orgExists(ctx: Context, orgId: string): Promise<boolean> {
    const data = await ctx.stub.getState(this.orgKey(orgId));
    return data !== null && data.length > 0;
  }

  private async getOrg(ctx: Context, orgId: string): Promise<Organization> {
    const data = await ctx.stub.getState(this.orgKey(orgId));
    if (!data || data.length === 0) throw new Error(`Organization ${orgId} not found`);
    const org = JSON.parse(data.toString()) as Organization;

    return org;
  }
}
