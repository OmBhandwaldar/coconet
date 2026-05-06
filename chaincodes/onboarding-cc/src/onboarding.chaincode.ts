import { Context, Contract, Info, Returns, Transaction } from 'fabric-contract-api';

export interface Organization {
  org_id: string;
  legal_name: string;
  org_type: 'Buyer' | 'Supplier' | 'Lender' | 'Platform' | 'Auditor';
  registration_number: string;
  country: string;
  status: 'Pending' | 'Approved' | 'Suspended' | 'Closed';
  roles: string[];
  kyb_verified: boolean;
  created_at: string;
  updated_at: string;
}

@Info({ title: 'OnboardingChaincode', description: 'FR-ONB-01 to FR-ONB-04' })
export class OnboardingChaincode extends Contract {

  // ─── FR-ONB-01: Create organisation ──────────────────────────────────────
  @Transaction()
  async createOrganization(ctx: Context, orgJson: string): Promise<string> {
    const input = JSON.parse(orgJson) as Partial<Organization>;

    if (!input.org_id) throw new Error('org_id is required');
    if (!input.legal_name) throw new Error('legal_name is required');
    if (!input.org_type) throw new Error('org_type is required');

    const exists = await this.orgExists(ctx, input.org_id);
    if (exists) throw new Error(`Organization ${input.org_id} already exists`);

    const now = new Date().toISOString();
    const org: Organization = {
      org_id: input.org_id,
      legal_name: input.legal_name,
      org_type: input.org_type,
      registration_number: input.registration_number ?? '',
      country: input.country ?? '',
      status: 'Pending',
      roles: input.roles ?? [],
      kyb_verified: false,
      created_at: now,
      updated_at: now,
    };

    await ctx.stub.putState(this.orgKey(input.org_id), Buffer.from(JSON.stringify(org)));
    ctx.stub.setEvent('OrganizationCreated', Buffer.from(JSON.stringify({ org_id: org.org_id, org_type: org.org_type })));

    return JSON.stringify(org);
  }

  // ─── FR-ONB-02: Approve / Suspend org (BRD Rule maker-checker aware) ─────
  @Transaction()
  async updateOrganizationStatus(ctx: Context, orgId: string, newStatus: string): Promise<string> {
    const org = await this.getOrg(ctx, orgId);

    const allowed: Record<Organization['status'], Organization['status'][]> = {
      Pending: ['Approved', 'Closed'],
      Approved: ['Suspended', 'Closed'],
      Suspended: ['Approved', 'Closed'],
      Closed: [],
    };
    if (!allowed[org.status].includes(newStatus as Organization['status'])) {
      throw new Error(`Illegal transition ${org.status} → ${newStatus}`);
    }

    org.status = newStatus as Organization['status'];
    org.updated_at = new Date().toISOString();

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
    org.updated_at = new Date().toISOString();

    await ctx.stub.putState(this.orgKey(orgId), Buffer.from(JSON.stringify(org)));
    ctx.stub.setEvent('RoleAssigned', Buffer.from(JSON.stringify({ org_id: orgId, role })));

    return JSON.stringify(org);
  }

  // ─── FR-ONB-04: Read org ──────────────────────────────────────────────────
  @Transaction(false)
  @Returns('string')
  async getOrganization(ctx: Context, orgId: string): Promise<string> {
    return JSON.stringify(await this.getOrg(ctx, orgId));
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
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
    return JSON.parse(data.toString()) as Organization;
  }
}
