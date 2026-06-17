import { Router } from 'express';
import healthRouter from './health.route.js';
import onboardingRouter from './onboarding.route.js';
import tradeDocRouter from './trade-doc.route.js';
import financeRouter from './finance.route.js';

const router = Router();

router.use('/health', healthRouter);
router.use('/onboarding', onboardingRouter);
router.use('/trade-docs', tradeDocRouter);
router.use('/finance', financeRouter);

export default router;
