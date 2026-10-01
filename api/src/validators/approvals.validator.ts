import { z } from 'zod';
import { TX_TYPES } from '../services/approvals.service.js';

// The transaction type comes from the chaincodes' own list rather than a second
// copy of it here, so adding a gate cannot leave the API rejecting it.
const txType = z.enum(TX_TYPES as [string, ...string[]]);

export const approvalParamSchema = z.object({
  params: z.object({
    txType,
    entityId: z.string().min(1),
  }),
});

export const rejectApprovalSchema = z.object({
  params: z.object({
    txType,
    entityId: z.string().min(1),
  }),
  // NFR-05: a refusal without a stated reason is not an audit trail.
  body: z.object({ reason: z.string().min(1) }),
});

export const listApprovalsSchema = z.object({
  query: z.object({ org_id: z.string().min(1).optional() }),
});
