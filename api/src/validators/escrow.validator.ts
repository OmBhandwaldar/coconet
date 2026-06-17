import { z } from 'zod';

export const createInstructionSchema = z.object({
  body: z.object({
    escrow_payment_id: z.string().min(1),
    buyer_org_id: z.string().min(1),
    beneficiary_org_id: z.string().min(1),
    linked_invoice_id: z.string().min(1),
    amount_usd: z.number().positive(),
    expiry_at: z.number().int().nonnegative().optional(),
  }),
});

export const escrowIdParamSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
});

export type CreateInstructionBody = z.infer<typeof createInstructionSchema>['body'];
