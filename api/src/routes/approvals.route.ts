import { Router } from 'express';
import * as controller from '../controllers/approvals.controller.js';
import { validate } from '../middleware/validate.middleware.js';
import {
  approvalParamSchema,
  listApprovalsSchema,
  rejectApprovalSchema,
} from '../validators/approvals.validator.js';

const router = Router();

// The approval queue (BR-09). Each chaincode scopes its answer to what the
// caller's organisation may act on, so there is no org-type guard here: a
// lender has a queue just as a buyer does, and neither can see the other's.
router.get('/pending', validate(listApprovalsSchema), controller.listPending);
router.get('/:txType/:entityId', validate(approvalParamSchema), controller.getApproval);
router.post('/:txType/:entityId/reject', validate(rejectApprovalSchema), controller.rejectApproval);

export default router;
