import { Router } from 'express';
import multer from 'multer';
import * as controller from '../controllers/trade-doc.controller.js';
import { validate } from '../middleware/validate.middleware.js';
import {
  acknowledgePOSchema,
  amendPOSchema,
  createGRNSchema,
  createPOSchema,
  grnIdParamSchema,
  invoiceIdParamSchema,
  invoiceReasonSchema,
  poIdParamSchema,
  submitInvoiceSchema,
} from '../validators/trade-doc.validator.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ─── Purchase Orders ──────────────────────────────────────────────────────────
router.post('/purchase-orders', validate(createPOSchema), controller.createPO);
router.get('/purchase-orders/:id', validate(poIdParamSchema), controller.getPO);
router.put('/purchase-orders/:id/acknowledge', validate(acknowledgePOSchema), controller.acknowledgePO);
router.put('/purchase-orders/:id/amend', validate(amendPOSchema), controller.amendPO);
router.put('/purchase-orders/:id/lock', validate(poIdParamSchema), controller.lockPO);
router.put('/purchase-orders/:id/fulfill', validate(poIdParamSchema), controller.fulfillPO);

// ─── Goods Receipt ──────────────────────────────────────────────────────────
router.post('/grn', validate(createGRNSchema), controller.createGRN);
router.get('/grn/:id', validate(grnIdParamSchema), controller.getGRN);
router.put('/grn/:id/accept', validate(grnIdParamSchema), controller.acceptGRN);

// ─── Invoices ─────────────────────────────────────────────────────────────────
router.post('/invoices', validate(submitInvoiceSchema), controller.submitInvoice);
router.get('/invoices/:id', validate(invoiceIdParamSchema), controller.getInvoice);
router.put('/invoices/:id/match', validate(invoiceIdParamSchema), controller.matchInvoice);
router.get('/invoices/:id/match-result', validate(invoiceIdParamSchema), controller.getMatchResult);
router.put('/invoices/:id/approve', validate(invoiceIdParamSchema), controller.approveInvoice);
router.put('/invoices/:id/reject', validate(invoiceReasonSchema), controller.rejectInvoice);
router.put('/invoices/:id/dispute', validate(invoiceReasonSchema), controller.disputeInvoice);

// ─── Documents ────────────────────────────────────────────────────────────────
router.post('/documents/upload', upload.single('file'), controller.uploadDocument);
router.get('/documents/:hash/verify', controller.verifyDocument);

export default router;
