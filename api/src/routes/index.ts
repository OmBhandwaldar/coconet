import { Router } from 'express';
import healthRouter from './health.route.js';
import onboardingRouter from './onboarding.route.js';

const router = Router();

router.use('/health', healthRouter);
router.use('/onboarding', onboardingRouter);

export default router;
