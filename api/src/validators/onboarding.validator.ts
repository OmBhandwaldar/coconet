import { z } from 'zod';

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9]{1}[A-Z]{1}[0-9A-Z]{1}$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

export const orgTypeSchema = z.enum(['Buyer', 'Supplier', 'Lender', 'Platform', 'Auditor']);
export const orgStatusSchema = z.enum(['Pending', 'Approved', 'Suspended', 'Closed']);
export const riskTierSchema = z.enum(['Prime', 'Standard', 'High-touch']);

export const createOrganizationSchema = z.object({
  body: z.object({
    org_id: z.string().min(1),
    legal_name: z.string().min(1),
    org_type: orgTypeSchema,
    msp_id: z.string().min(1),
    registration_number: z.string().min(1),
    gstin: z.string().regex(GSTIN_REGEX, 'Invalid GSTIN'),
    pan: z.string().regex(PAN_REGEX, 'Invalid PAN'),
    country: z.string().min(2).max(3),
    contact_email: z.string().email(),
    registered_address: z.string().min(1),
    incorporation_year: z.number().int().min(1800).max(2100).optional(),
    industry: z.string().optional(),
    turnover_band: z.string().optional(),
    employee_count: z.number().int().nonnegative().optional(),
    bank_account_ref: z.string().optional(),
  }),
});

export const orgIdParamSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
});

export const updateStatusSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({ status: orgStatusSchema }),
});

export const assignRoleSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({ role: z.string().min(1) }),
});

export const setRiskTierSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({ risk_tier: riskTierSchema }),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>['body'];
