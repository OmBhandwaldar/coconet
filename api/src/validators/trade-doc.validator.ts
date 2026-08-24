import { z } from 'zod';

// ─── Purchase Orders ──────────────────────────────────────────────────────────
export const createPOSchema = z.object({
  body: z.object({
    po_id: z.string().min(1),
    buyer_id: z.string().min(1),
    supplier_id: z.string().min(1),
    currency: z.string().min(1),
    gross_value: z.number().positive(),
    item_description: z.string().min(1),
    quantity: z.number().positive(),
    price_per_unit: z.number().positive(),
    delivery_terms: z.string().optional(),
    payment_terms: z.string().optional(),
    doc_hash: z.string().optional(),
  }),
});

export const poIdParamSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
});

export const acknowledgePOSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({ supplier_id: z.string().min(1) }),
});

export const amendPOSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    changes: z.record(z.unknown()),
    justification: z.string().min(1),
  }),
});

// ─── Goods Receipt ──────────────────────────────────────────────────────────
export const createGRNSchema = z.object({
  body: z.object({
    grn_id: z.string().min(1),
    po_id: z.string().min(1),
    received_qty: z.number().positive(),
    doc_hash: z.string().optional(),
  }),
});

export const grnIdParamSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
});

// ─── Invoices ─────────────────────────────────────────────────────────────────
export const submitInvoiceSchema = z.object({
  body: z.object({
    invoice_id: z.string().min(1),
    supplier_id: z.string().min(1),
    buyer_id: z.string().min(1),
    po_id: z.string().min(1),
    grn_id: z.string().min(1),
    amount: z.number().positive(),
    quantity: z.number().positive(),
    currency: z.string().optional(),
    due_date: z.string().min(1),
    doc_hash: z.string().min(1),
  }),
});

export const invoiceIdParamSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
});

export const invoiceReasonSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({ reason: z.string().optional() }),
});

export const reviseInvoiceSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    amount: z.number().positive(),
    quantity: z.number().positive(),
    doc_hash: z.string().optional(),
  }),
});

export type CreatePOInput = z.infer<typeof createPOSchema>['body'];
export type SubmitInvoiceInput = z.infer<typeof submitInvoiceSchema>['body'];
