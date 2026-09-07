import { Router } from 'express';
import * as controller from '../controllers/payment.controller.js';
import { validate } from '../middleware/validate.middleware.js';
import { initiatePaymentSchema, paymentIdParamSchema } from '../validators/payment.validator.js';

const router = Router();

// Off-chain bank settlement rail (mocked NEFT/RTGS) — the alternative to on-chain escrow.
router.post('/', validate(initiatePaymentSchema), controller.initiate);
router.get('/:id', validate(paymentIdParamSchema), controller.get);
router.put('/:id/confirm', validate(paymentIdParamSchema), controller.confirm);

export default router;
