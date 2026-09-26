import { Router } from 'express';
import multer from 'multer';
import * as controller from '../controllers/trade-doc.controller.js';
import { validate } from '../middleware/validate.middleware.js';
import { requireOrgType } from '../middleware/rbac.middleware.js';
import {
  acknowledgePOSchema,
  amendPOSchema,
  createGRNSchema,
  createPOSchema,
  grnIdParamSchema,
  invoiceIdParamSchema,
  invoiceReasonSchema,
  poIdParamSchema,
  reviseInvoiceSchema,
  submitInvoiceSchema,
} from '../validators/trade-doc.validator.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ─── Purchase Orders ──────────────────────────────────────────────────────────
// The buyer owns the order; the supplier only acknowledges it. Without this, a
// supplier identity could raise a purchase order against itself.
const buyer = requireOrgType('Buyer');
const supplier = requireOrgType('Supplier');

router.post('/purchase-orders', buyer, validate(createPOSchema), controller.createPO);
router.get('/purchase-orders/:id', validate(poIdParamSchema), controller.getPO);
router.put('/purchase-orders/:id/acknowledge', supplier, validate(acknowledgePOSchema), controller.acknowledgePO);
router.put('/purchase-orders/:id/amend', buyer, validate(amendPOSchema), controller.amendPO);
router.put('/purchase-orders/:id/lock', validate(poIdParamSchema), controller.lockPO);
router.put('/purchase-orders/:id/fulfill', buyer, validate(poIdParamSchema), controller.fulfillPO);

// ─── Goods Receipt ──────────────────────────────────────────────────────────
router.post('/grn', buyer, validate(createGRNSchema), controller.createGRN);
router.get('/grn/:id', validate(grnIdParamSchema), controller.getGRN);
router.put('/grn/:id/accept', buyer, validate(grnIdParamSchema), controller.acceptGRN);

// ─── Invoices ─────────────────────────────────────────────────────────────────
router.post('/invoices', supplier, validate(submitInvoiceSchema), controller.submitInvoice);
router.get('/invoices/:id', validate(invoiceIdParamSchema), controller.getInvoice);
router.put('/invoices/:id/match', validate(invoiceIdParamSchema), controller.matchInvoice);
router.put('/invoices/:id/revise', supplier, validate(reviseInvoiceSchema), controller.reviseInvoice);
router.get('/invoices/:id/match-result', validate(invoiceIdParamSchema), controller.getMatchResult);
router.put('/invoices/:id/approve', buyer, validate(invoiceIdParamSchema), controller.approveInvoice);
router.put('/invoices/:id/reject', buyer, validate(invoiceReasonSchema), controller.rejectInvoice);
router.put('/invoices/:id/dispute', buyer, validate(invoiceReasonSchema), controller.disputeInvoice);

// ─── Documents ────────────────────────────────────────────────────────────────
router.post('/documents/upload', upload.single('file'), controller.uploadDocument);
router.post('/documents/parse', upload.single('file'), controller.parseDocument);
router.get('/documents/:hash/verify', controller.verifyDocument);
router.get('/documents/:hash', controller.getDocument);

export default router;
