import { Router } from 'express';
import healthRouter from './health.route.js';
import onboardingRouter from './onboarding.route.js';
import tradeDocRouter from './trade-doc.route.js';
import financeRouter from './finance.route.js';
import escrowRouter from './escrow.route.js';
import activityRouter from './activity.route.js';
import paymentRouter from './payment.route.js';

const router = Router();

router.use('/health', healthRouter);
router.use('/onboarding', onboardingRouter);
router.use('/trade-docs', tradeDocRouter);
router.use('/finance', financeRouter);
router.use('/escrow', escrowRouter);
router.use('/activity', activityRouter);
router.use('/payments', paymentRouter);

export default router;
