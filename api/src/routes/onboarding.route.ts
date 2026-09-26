import { Router } from 'express';
import * as controller from '../controllers/onboarding.controller.js';
import { validate } from '../middleware/validate.middleware.js';
import { requireOrgType } from '../middleware/rbac.middleware.js';
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

// Membership is the consortium's to grant, not a member's. Only the platform
// operator may onboard, approve, suspend or re-tier an organisation (BR-01).
const platform = requireOrgType('Platform');

router.post('/organizations', platform, validate(createOrganizationSchema), controller.create);
router.get('/organizations/:id', validate(orgIdParamSchema), controller.read);
router.put('/organizations/:id/status', platform, validate(updateStatusSchema), controller.updateStatus);
router.post('/organizations/:id/roles', platform, validate(assignRoleSchema), controller.assignRole);
router.post('/organizations/:id/risk-tier', platform, validate(setRiskTierSchema), controller.setRiskTier);
router.put(
  '/organizations/:id/maker-checker-thresholds/:txType',
  platform,
  validate(setMakerCheckerThresholdSchema),
  controller.setMakerCheckerThreshold,
);
router.get(
  '/organizations/:id/maker-checker-thresholds/:txType',
  validate(getMakerCheckerThresholdSchema),
  controller.getMakerCheckerThreshold,
);

export default router;
