import { Router } from 'express';
import * as controller from '../controllers/escrow.controller.js';
import { validate } from '../middleware/validate.middleware.js';
import { requireOrgType } from '../middleware/rbac.middleware.js';
import { createInstructionSchema, escrowIdParamSchema } from '../validators/escrow.validator.js';

const router = Router();

// Escrow is buyer-funded (BRD BR-12), so only the buyer creates, funds or
// refunds one. Release is never manual — it is evaluated on-chain.
const buyer = requireOrgType('Buyer');

router.post('/instructions', buyer, validate(createInstructionSchema), controller.createInstruction);
router.get('/instructions/:id', validate(escrowIdParamSchema), controller.get);
router.post('/instructions/:id/fund', buyer, validate(escrowIdParamSchema), controller.fund);
router.post('/instructions/:id/refund', buyer, validate(escrowIdParamSchema), controller.refund);
router.get('/instructions/:id/status', validate(escrowIdParamSchema), controller.status);

export default router;
