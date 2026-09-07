import { z } from 'zod';

// IFSC: 4-letter bank code + '0' (reserved) + 6-char branch code. e.g. HDFC0001234
const ifsc = z.string().regex(/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/, 'IFSC must look like HDFC0001234');
// Indian bank account numbers run 9–18 digits.
const accountNumber = z.string().regex(/^\d{9,18}$/, 'Account number must be 9–18 digits');
const bankName = z.string().min(2, 'Bank name is required');
const branch = z.string().min(2, 'Branch is required');
// Bank references vary by rail/bank; accept a plausible alphanumeric reference.
const utr = z.string().regex(/^[A-Za-z0-9]{12,22}$/, 'UTR should be 12–22 letters/digits');

export const initiatePaymentSchema = z.object({
  body: z.object({
    payment_id: z.string().min(1),
    payer_org_id: z.string().min(1),
    beneficiary_org_id: z.string().min(1),
    beneficiary_name: z.string().min(1),
    account_number: accountNumber,
    ifsc,
    bank_name: bankName,
    branch,
    amount_inr: z.number().positive(),
    purpose: z.enum(['PreShipment', 'Discounting', 'Settlement']),
    utr: utr.optional(),
    linked_invoice_id: z.string().optional(),
  }),
});

export const paymentIdParamSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
});

export const bankAccountSchema = z.object({
  params: z.object({ orgId: z.string().min(1) }),
  body: z.object({
    beneficiary_name: z.string().min(1),
    account_number: accountNumber,
    ifsc,
    bank_name: bankName,
    branch,
  }),
});

export const orgIdParamSchema = z.object({
  params: z.object({ orgId: z.string().min(1) }),
});
