import { z } from 'zod';

// IFSC: 4-letter bank code + '0' (reserved) + 6-char branch code. e.g. HDFC0001234
const ifsc = z.string().regex(/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/, 'IFSC must look like HDFC0001234');
// Indian bank account numbers run 9–18 digits.
const accountNumber = z.string().regex(/^\d{9,18}$/, 'Account number must be 9–18 digits');

export const initiatePaymentSchema = z.object({
  body: z.object({
    payment_id: z.string().min(1),
    payer_org_id: z.string().min(1),
    beneficiary_org_id: z.string().min(1),
    beneficiary_name: z.string().min(1),
    account_number: accountNumber,
    ifsc,
    amount_inr: z.number().positive(),
    linked_invoice_id: z.string().optional(),
  }),
});

export const paymentIdParamSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
});
