import { Router } from 'express';
import healthRouter from './health.route.js';
import authRouter from './auth.route.js';
import onboardingRouter from './onboarding.route.js';
import tradeDocRouter from './trade-doc.route.js';
import financeRouter from './finance.route.js';
import escrowRouter from './escrow.route.js';
import activityRouter from './activity.route.js';
import paymentRouter from './payment.route.js';
import approvalsRouter from './approvals.route.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { enforceReadOnlyForObservers } from '../middleware/rbac.middleware.js';

const router = Router();

// Open: liveness, and the endpoint you use to obtain a token.
router.use('/health', healthRouter);
router.use('/auth', authRouter);

// Everything below requires a valid token. Mounting the guard here rather than
// per-route means a new router is protected by default, not by remembering.
router.use(authenticate);
router.use(enforceReadOnlyForObservers);

router.use('/onboarding', onboardingRouter);
router.use('/trade-docs', tradeDocRouter);
router.use('/finance', financeRouter);
router.use('/escrow', escrowRouter);
router.use('/activity', activityRouter);
router.use('/payments', paymentRouter);
router.use('/approvals', approvalsRouter);

export default router;
