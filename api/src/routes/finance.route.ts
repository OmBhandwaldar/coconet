import { Router } from 'express';
import * as controller from '../controllers/finance.controller.js';
import { validate } from '../middleware/validate.middleware.js';
import { requireOrgType } from '../middleware/rbac.middleware.js';
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

// The supplier asks for financing and accepts the offer; the lender validates,
// prices, approves and disburses it. Neither side may play the other's part.
const supplier = requireOrgType('Supplier');
const lender = requireOrgType('Lender');

// Product entry points
router.post('/pre-shipment', supplier, validate(preShipmentSchema), controller.createPreShipment);
router.post('/invoice-discounting', supplier, validate(invoiceDiscountingSchema), controller.createInvoiceDiscounting);

// Shared lifecycle
router.get('/:id', validate(financeIdParamSchema), controller.get);
router.put('/:id/validate-eligibility', lender, validate(financeIdParamSchema), controller.validateEligibility);
router.put('/:id/quote', lender, validate(quoteSchema), controller.submitQuote);
router.put('/:id/approve', lender, validate(approveSchema), controller.approve);
router.put('/:id/accept', supplier, validate(financeIdParamSchema), controller.accept);
router.get('/:id/net-settlement-preview', validate(financeIdParamSchema), controller.netSettlementPreview);
router.put('/:id/disburse', lender, validate(disburseSchema), controller.disburse);
router.put('/:id/repay', lender, validate(repaySchema), controller.repay);

export default router;
