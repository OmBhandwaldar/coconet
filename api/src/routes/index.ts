import { Router } from 'express';
import healthRouter from './health.route.js';

const router = Router();

router.use('/health', healthRouter);

export default router;
