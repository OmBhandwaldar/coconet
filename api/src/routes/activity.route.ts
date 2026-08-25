import { Router } from 'express';
import * as controller from '../controllers/activity.controller.js';

const router = Router();

// GET /api/activity?deal=&after=&limit=
router.get('/', controller.getActivity);

export default router;
