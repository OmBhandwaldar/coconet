// Seeds the 6 MVP organisations end-to-end via the live API:
//   create (Pending) → status=Approved → assignRole(s) → setRiskTier
//
// Run with the API up:
//   Terminal 1:  npm run dev --workspace=@coconet/api
//   Terminal 2:  npm run seed --workspace=@coconet/api
//
// Idempotent: re-running skips create when the org already exists.

const API_BASE = process.env.API_BASE ?? 'http://localhost:3000/api/onboarding';

interface SeedOrg {
  body: Record<string, unknown>;
  approve: boolean;
  roles: string[];
  risk_tier?: 'Prime' | 'Standard' | 'High-touch';
}

const orgs: SeedOrg[] = [
  {
    body: {
      org_id: 'tata-001',
      legal_name: 'Tata Motors Ltd',
      org_type: 'Buyer',
      msp_id: 'BuyerMSP',
      registration_number: 'L28920MH1945PLC004520',
      gstin: '27AAACT2727Q1ZW',
      pan: 'AAACT2727Q',
      country: 'IN',
      contact_email: 'procurement@tatamotors.com',
      registered_address: 'Bombay House, 24 Homi Mody Street, Mumbai 400001',
      incorporation_year: 1945,
      industry: 'Automotive',
      turnover_band: '> 500 cr',
      employee_count: 80000,
    },
    approve: true,
    roles: ['procurement_maker', 'procurement_checker', 'ap_maker'],
    risk_tier: 'Prime',
  },
  {
    body: {
      org_id: 'bharat-001',
      legal_name: 'Bharat Stampings Pvt Ltd',
      org_type: 'Supplier',
      msp_id: 'SupplierMSP',
      registration_number: 'U28910MH2002PTC135421',
      gstin: '27AABCB1234C1ZX',
      pan: 'AABCB1234C',
      country: 'IN',
      contact_email: 'sales@bharatstampings.com',
      registered_address: 'Plot 14, MIDC Phase II, Pune 411019',
      incorporation_year: 2002,
      industry: 'Auto Components',
      turnover_band: '50-500 cr',
      employee_count: 450,
    },
    approve: true,
    roles: ['sales_director', 'finance_manager'],
    risk_tier: 'Standard',
  },
  {
    body: {
      org_id: 'mforge-001',
      legal_name: 'Maharashtra Forge Ltd',
      org_type: 'Supplier',
      msp_id: 'SupplierMSP',
      registration_number: 'U27109MH1998PLC114598',
      gstin: '27AABCM5678D1ZY',
      pan: 'AABCM5678D',
      country: 'IN',
      contact_email: 'sales@mforge.in',
      registered_address: '23 Industrial Estate, Aurangabad 431001',
      incorporation_year: 1998,
      industry: 'Forging & Machining',
      turnover_band: '50-500 cr',
      employee_count: 320,
    },
    approve: true,
    roles: ['sales_director'],
    risk_tier: 'Standard',
  },
  {
    body: {
      org_id: 'hdfc-001',
      legal_name: 'HDFC Bank Ltd',
      org_type: 'Lender',
      msp_id: 'LenderMSP',
      registration_number: 'L65920MH1994PLC080618',
      gstin: '27AAACH2702H1Z9',
      pan: 'AAACH2702H',
      country: 'IN',
      contact_email: 'tradefinance@hdfcbank.com',
      registered_address: 'HDFC Bank House, Senapati Bapat Marg, Mumbai 400013',
      incorporation_year: 1994,
      industry: 'Banking',
      turnover_band: '> 500 cr',
      employee_count: 160000,
    },
    approve: true,
    roles: ['relationship_manager', 'credit_head'],
    risk_tier: 'Prime',
  },
  {
    body: {
      org_id: 'platform-001',
      legal_name: 'CocoNet Platform Pvt Ltd',
      org_type: 'Platform',
      msp_id: 'PlatformMSP',
      registration_number: 'U72900MH2026PTC400001',
      gstin: '27AAACP9999P1ZQ',
      pan: 'AAACP9999P',
      country: 'IN',
      contact_email: 'ops@coconet.io',
      registered_address: 'BKC, Bandra East, Mumbai 400051',
      incorporation_year: 2026,
      industry: 'FinTech / Trade Finance Infrastructure',
    },
    approve: true,
    roles: ['platform_admin', 'sanctions_officer'],
    risk_tier: 'Prime',
  },
  {
    body: {
      org_id: 'auditor-001',
      legal_name: 'CocoNet Audit Services LLP',
      org_type: 'Auditor',
      msp_id: 'AuditorMSP',
      registration_number: 'AAB-1234',
      gstin: '27AAACA8888K1Z5',
      pan: 'AAACA8888K',
      country: 'IN',
      contact_email: 'audit@coconet.io',
      registered_address: 'BKC, Bandra East, Mumbai 400051',
      incorporation_year: 2026,
      industry: 'Audit & Assurance',
    },
    approve: true,
    roles: ['auditor_read_only'],
    risk_tier: 'Prime',
  },
];

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

async function call<T>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return (await res.json()) as ApiResponse<T>;
}

interface OrgState {
  status: string;
  roles: string[];
  risk_tier?: string;
}

async function fetchState(orgId: string): Promise<OrgState | null> {
  const r = await call<OrgState>('GET', `/organizations/${orgId}`);
  return r.success && r.data ? r.data : null;
}

async function seedOne(o: SeedOrg): Promise<void> {
  const id = o.body.org_id as string;
  let state = await fetchState(id);

  if (!state) {
    const r = await call<OrgState>('POST', '/organizations', o.body);
    if (!r.success) throw new Error(`create ${id}: ${r.error?.message}`);
    state = r.data!;
    console.log(`  [created] ${id} (${o.body.legal_name})`);
  } else {
    console.log(`  [exists] ${id} (status=${state.status})`);
  }

  if (o.approve && state.status === 'Pending') {
    const r = await call('PUT', `/organizations/${id}/status`, { status: 'Approved' });
    if (!r.success) throw new Error(`approve ${id}: ${r.error?.message}`);
    console.log(`  [approved] ${id}`);
  }

  const newRoles = o.roles.filter((role) => !state!.roles.includes(role));
  for (const role of newRoles) {
    const r = await call('POST', `/organizations/${id}/roles`, { role });
    if (!r.success) throw new Error(`role ${role}@${id}: ${r.error?.message}`);
  }
  if (newRoles.length) console.log(`  [roles] ${id} ← ${newRoles.join(', ')}`);

  if (o.risk_tier && state.risk_tier !== o.risk_tier) {
    const r = await call('POST', `/organizations/${id}/risk-tier`, { risk_tier: o.risk_tier });
    if (!r.success) throw new Error(`risk-tier ${id}: ${r.error?.message}`);
    console.log(`  [risk] ${id} ← ${o.risk_tier}`);
  }
}

async function main(): Promise<void> {
  console.log(`Seeding ${orgs.length} organisations against ${API_BASE}\n`);
  for (const o of orgs) {
    console.log(`→ ${o.body.org_id}`);
    await seedOne(o);
    console.log();
  }
  console.log('Seed complete.');
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
