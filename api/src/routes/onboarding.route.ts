import { Router } from 'express';
import * as controller from '../controllers/onboarding.controller.js';
import { validate } from '../middleware/validate.middleware.js';
import {
  assignRoleSchema,
  createOrganizationSchema,
  getMakerCheckerThresholdSchema,
  orgIdParamSchema,
  setMakerCheckerThresholdSchema,
  setRiskTierSchema,
  updateStatusSchema,
} from '../validators/onboarding.validator.js';

const router = Router();

router.post('/organizations', validate(createOrganizationSchema), controller.create);
router.get('/organizations/:id', validate(orgIdParamSchema), controller.read);
router.put('/organizations/:id/status', validate(updateStatusSchema), controller.updateStatus);
router.post('/organizations/:id/roles', validate(assignRoleSchema), controller.assignRole);
router.post('/organizations/:id/risk-tier', validate(setRiskTierSchema), controller.setRiskTier);
router.put(
  '/organizations/:id/maker-checker-thresholds/:txType',
  validate(setMakerCheckerThresholdSchema),
  controller.setMakerCheckerThreshold,
);
router.get(
  '/organizations/:id/maker-checker-thresholds/:txType',
  validate(getMakerCheckerThresholdSchema),
  controller.getMakerCheckerThreshold,
);

export default router;
