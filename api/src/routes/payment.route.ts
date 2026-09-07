import { Router } from 'express';
import * as controller from '../controllers/payment.controller.js';
import { validate } from '../middleware/validate.middleware.js';
import { bankAccountSchema, initiatePaymentSchema, orgIdParamSchema, paymentIdParamSchema } from '../validators/payment.validator.js';

const router = Router();

// Off-chain bank settlement rail (mocked NEFT/RTGS) — the alternative to on-chain escrow.
// Beneficiary accounts — declared before /:id so "accounts" isn't read as a payment id.
router.get('/accounts/:orgId', validate(orgIdParamSchema), controller.getAccount);
router.put('/accounts/:orgId', validate(bankAccountSchema), controller.saveAccount);

router.post('/', validate(initiatePaymentSchema), controller.initiate);
router.get('/:id', validate(paymentIdParamSchema), controller.get);
router.put('/:id/confirm', validate(paymentIdParamSchema), controller.confirm);

export default router;
