import { Router } from 'express';
import healthRouter from './health.route.js';
import onboardingRouter from './onboarding.route.js';
import tradeDocRouter from './trade-doc.route.js';

const router = Router();

router.use('/health', healthRouter);
router.use('/onboarding', onboardingRouter);
router.use('/trade-docs', tradeDocRouter);

export default router;
