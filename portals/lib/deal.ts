'use client';
import { useEffect, useState } from 'react';
import { apiCall } from './api';

const KEY = 'coconet_deal';

// Seeded org identities (from api/scripts/seed-orgs.ts) — the UI shows generic
// role names but the API needs these org ids (they map to EVM addresses too).
export const ORG = {
  buyer: 'tata-001',
  supplier: 'bharat-001',
  lender: 'hdfc-001',
} as const;

export interface DealIds {
  po: string;
  grn: string;
  inv: string;      // discounting invoice
  frPre: string;    // pre-shipment finance request
  frDisc: string;   // invoice-discounting finance request
  escInv: string;   // dedicated escrow invoice (approved AFTER funding to trigger release)
  esc: string;      // escrow
}

export function idsFor(code: string): DealIds {
  return {
    po: `PO-${code}`,
    grn: `GRN-${code}`,
    inv: `INV-${code}`,
    frPre: `FRPRE-${code}`,
    frDisc: `FRDISC-${code}`,
    escInv: `ESCINV-${code}`,
    esc: `ESC-${code}`,
  };
}

// Shared across tabs of the same browser via localStorage + the storage event.
export function useDeal() {
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    setCode(localStorage.getItem(KEY));
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setCode(e.newValue);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  function setDeal(next: string) {
    localStorage.setItem(KEY, next);
    setCode(next);
  }

  return {
    code,
    ids: code ? idsFor(code) : null,
    setDeal,
    newCode: () => 'D-' + Date.now().toString(36).toUpperCase(),
  };
}

// Idempotently ensure the three orgs exist + are approved (tolerate "already exists").
const ORG_BODIES: Record<string, Record<string, unknown>> = {
  'tata-001': { org_id: 'tata-001', legal_name: 'Buyer Corp', org_type: 'Buyer', msp_id: 'BuyerMSP', registration_number: 'L28920MH1945PLC004520', gstin: '27AAACT2727Q1ZW', pan: 'AAACT2727Q', country: 'IN', contact_email: 'buyer@example.com', registered_address: 'Mumbai 400001' },
  'bharat-001': { org_id: 'bharat-001', legal_name: 'Supplier Ltd', org_type: 'Supplier', msp_id: 'SupplierMSP', registration_number: 'U28910MH2002PTC135421', gstin: '27AABCB1234C1ZX', pan: 'AABCB1234C', country: 'IN', contact_email: 'supplier@example.com', registered_address: 'Pune 411019' },
  'hdfc-001': { org_id: 'hdfc-001', legal_name: 'Lender Bank', org_type: 'Lender', msp_id: 'LenderMSP', registration_number: 'L65920MH1994PLC080618', gstin: '27AAACH2702H1Z9', pan: 'AAACH2702H', country: 'IN', contact_email: 'lender@example.com', registered_address: 'Mumbai 400013' },
};

export async function ensureOrgs(): Promise<void> {
  for (const [id, body] of Object.entries(ORG_BODIES)) {
    await apiCall('POST', '/api/onboarding/organizations', body); // tolerate 502 if exists
    await apiCall('PUT', `/api/onboarding/organizations/${id}/status`, { status: 'Approved' });
  }
}
