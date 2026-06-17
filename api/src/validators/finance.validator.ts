import { z } from 'zod';

export const preShipmentSchema = z.object({
  body: z.object({
    request_id: z.string().min(1),
    po_id: z.string().min(1),
    requestor_org_id: z.string().min(1),
    requested_amount: z.number().positive(),
    lender_id: z.string().optional(),
  }),
});

export const invoiceDiscountingSchema = z.object({
  body: z.object({
    request_id: z.string().min(1),
    invoice_id: z.string().min(1),
    requestor_org_id: z.string().min(1),
    requested_amount: z.number().positive(),
    lender_id: z.string().min(1),
    discount_rate: z.number().min(0).max(1),
  }),
});

export const financeIdParamSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
});

export const assignLenderSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({ lender_id: z.string().min(1) }),
});

export const quoteSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    advance_rate: z.number().min(0).max(1).optional(),
    discount_rate: z.number().min(0).max(1).optional(),
    interest_rate: z.number().min(0).max(1).optional(),
    tenor_days: z.number().int().positive().optional(),
  }),
});

export const approveSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({ approved_amount: z.number().positive() }),
});

export const disburseSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    disbursement_ref: z.string().min(1),
    // Provide pre_shipment_request_id to trigger net settlement against a prior loan.
    pre_shipment_request_id: z.string().optional(),
    net_amount: z.number().nonnegative().optional(),
  }),
});

export const repaySchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    amount: z.number().positive(),
    payment_ref: z.string().min(1),
  }),
});

export type PreShipmentBody = z.infer<typeof preShipmentSchema>['body'];
export type InvoiceDiscountingBody = z.infer<typeof invoiceDiscountingSchema>['body'];
