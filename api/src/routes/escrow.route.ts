import { Router } from 'express';
import * as controller from '../controllers/escrow.controller.js';
import { validate } from '../middleware/validate.middleware.js';
import { createInstructionSchema, escrowIdParamSchema } from '../validators/escrow.validator.js';

const router = Router();

router.post('/instructions', validate(createInstructionSchema), controller.createInstruction);
router.get('/instructions/:id', validate(escrowIdParamSchema), controller.get);
router.post('/instructions/:id/fund', validate(escrowIdParamSchema), controller.fund);
router.get('/instructions/:id/status', validate(escrowIdParamSchema), controller.status);

export default router;
