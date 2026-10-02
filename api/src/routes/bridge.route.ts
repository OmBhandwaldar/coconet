import { Router } from 'express';
import * as controller from '../controllers/bridge.controller.js';
import { requireOrgType } from '../middleware/rbac.middleware.js';

const router = Router();

// Bridge internals are the platform operator's business, not a counterparty's:
// the dead-letter queue names escrow ids and failure reasons across every deal
// on the network, so a buyer reading it would see traffic that is not theirs.
const platform = requireOrgType('Platform');

router.get('/status', platform, controller.status);
router.get('/dead-letters', platform, controller.deadLetters);
router.post('/dead-letters/reopen', platform, controller.reopen);
router.post('/reconcile', platform, controller.reconcile);

export default router;
