import { env } from '../config/env.js';
import { invoke, query } from '../fabric/fabric.service.js';
import type { CreateOrganizationInput } from '../validators/onboarding.validator.ts';

export interface Organization {
  org_id: string;
  legal_name: string;
  org_type: 'Buyer' | 'Supplier' | 'Lender' | 'Platform' | 'Auditor';
  msp_id: string;
  registration_number: string;
  gstin: string;
  pan: string;
  country: string;
  contact_email: string;
  registered_address: string;
  incorporation_year?: number;
  industry?: string;
  turnover_band?: string;
  employee_count?: number;
  bank_account_ref?: string;
  status: 'Pending' | 'Approved' | 'Suspended' | 'Closed';
  roles: string[];
  kyb_verified: boolean;
  risk_tier?: 'Prime' | 'Standard' | 'High-touch';
  maker_checker_thresholds: Record<string, number>;
  created_at: string;
  updated_at: string;
}

export interface ThresholdResult {
  org_id: string;
  tx_type: string;
  threshold: number;
}

const cc = env.FABRIC_CHAINCODE_ONBOARDING;

export async function createOrganization(input: CreateOrganizationInput): Promise<Organization> {
  return invoke<Organization>(cc, 'createOrganization', JSON.stringify(input));
}

export async function getOrganization(orgId: string): Promise<Organization> {
  return query<Organization>(cc, 'getOrganization', orgId);
}

export async function updateOrganizationStatus(orgId: string, status: string): Promise<Organization> {
  return invoke<Organization>(cc, 'updateOrganizationStatus', orgId, status);
}

export async function assignRole(orgId: string, role: string): Promise<Organization> {
  return invoke<Organization>(cc, 'assignRole', orgId, role);
}

export async function setRiskTier(orgId: string, tier: string): Promise<Organization> {
  return invoke<Organization>(cc, 'setRiskTier', orgId, tier);
}

export async function setMakerCheckerThreshold(
  orgId: string,
  txType: string,
  threshold: number,
): Promise<Organization> {
  return invoke<Organization>(cc, 'setMakerCheckerThreshold', orgId, txType, String(threshold));
}

export async function getMakerCheckerThreshold(
  orgId: string,
  txType: string,
): Promise<ThresholdResult> {
  return query<ThresholdResult>(cc, 'getMakerCheckerThreshold', orgId, txType);
}
