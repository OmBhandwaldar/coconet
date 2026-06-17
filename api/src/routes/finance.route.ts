import { Router } from 'express';
import * as controller from '../controllers/finance.controller.js';
import { validate } from '../middleware/validate.middleware.js';
import {
  approveSchema,
  disburseSchema,
  financeIdParamSchema,
  invoiceDiscountingSchema,
  preShipmentSchema,
  quoteSchema,
  repaySchema,
} from '../validators/finance.validator.js';

const router = Router();

// Product entry points
router.post('/pre-shipment', validate(preShipmentSchema), controller.createPreShipment);
router.post('/invoice-discounting', validate(invoiceDiscountingSchema), controller.createInvoiceDiscounting);

// Shared lifecycle
router.get('/:id', validate(financeIdParamSchema), controller.get);
router.put('/:id/validate-eligibility', validate(financeIdParamSchema), controller.validateEligibility);
router.put('/:id/quote', validate(quoteSchema), controller.submitQuote);
router.put('/:id/approve', validate(approveSchema), controller.approve);
router.put('/:id/accept', validate(financeIdParamSchema), controller.accept);
router.put('/:id/disburse', validate(disburseSchema), controller.disburse);
router.put('/:id/repay', validate(repaySchema), controller.repay);

export default router;
