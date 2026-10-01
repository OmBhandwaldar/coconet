import { afterEach, describe, expect, it, vi } from 'vitest';
import { FabricError } from '../errors/AppError.js';
import * as gateway from './gateway.js';
import { invoke, query } from './fabric.service.js';

const encoder = new TextEncoder();

function mockContract(overrides: Partial<{
  submit: (...args: string[]) => Promise<Uint8Array>;
  evaluate: (...args: string[]) => Promise<Uint8Array>;
}> = {}) {
  return {
    submitTransaction: vi.fn(overrides.submit ?? (async () => encoder.encode(''))),
    // Chaincodes that touch a private collection go through submit() so the
    // endorsing org can be named (PRIVACY-DESIGN.md §3.6).
    submit: vi.fn(overrides.submit ?? (async () => encoder.encode(''))),
    evaluateTransaction: vi.fn(overrides.evaluate ?? (async () => encoder.encode(''))),
  } as any;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('fabric.service', () => {
  describe('invoke', () => {
    it('parses JSON object response', async () => {
      const contract = mockContract({
        submit: async () => encoder.encode('{"org_id":"tata-001","status":"Pending"}'),
      });
      vi.spyOn(gateway, 'getContract').mockReturnValue(contract);

      const result = await invoke('onboarding-cc', 'createOrganization', '{"org_id":"tata-001"}');
      expect(result).toEqual({ org_id: 'tata-001', status: 'Pending' });
      // onboarding-cc writes private data, so the endorsing org is named rather
      // than left to discovery (PRIVACY-DESIGN.md §3.6).
      expect(contract.submit).toHaveBeenCalledWith('createOrganization', {
        arguments: ['{"org_id":"tata-001"}'],
        endorsingOrganizations: ['PlatformMSP'],
      });
    });

    it('returns null for empty response', async () => {
      const contract = mockContract();
      vi.spyOn(gateway, 'getContract').mockReturnValue(contract);

      const result = await invoke('onboarding-cc', 'noop');
      expect(result).toBeNull();
    });

    it('returns plain text when response is not JSON', async () => {
      const contract = mockContract({
        submit: async () => encoder.encode('just a string'),
      });
      vi.spyOn(gateway, 'getContract').mockReturnValue(contract);

      const result = await invoke<string>('onboarding-cc', 'getStatus');
      expect(result).toBe('just a string');
    });

    it('wraps chaincode errors in FabricError', async () => {
      const contract = mockContract({
        submit: async () => { throw new Error('Organization tata-001 already exists'); },
      });
      vi.spyOn(gateway, 'getContract').mockReturnValue(contract);

      await expect(
        invoke('onboarding-cc', 'createOrganization', '{}')
      ).rejects.toMatchObject({
        name: 'AppError',
        statusCode: 502,
        code: 'FABRIC_ERROR',
        chaincode: 'onboarding-cc',
        fn: 'createOrganization',
      });
    });
  });

  describe('query', () => {
    it('parses JSON response from evaluate path', async () => {
      const contract = mockContract({
        evaluate: async () => encoder.encode('{"org_id":"tata-001"}'),
      });
      vi.spyOn(gateway, 'getContract').mockReturnValue(contract);

      const result = await query('onboarding-cc', 'getOrganization', 'tata-001');
      expect(result).toEqual({ org_id: 'tata-001' });
      expect(contract.evaluateTransaction).toHaveBeenCalledWith('getOrganization', 'tata-001');
    });

    it('does not call submitTransaction for queries', async () => {
      const contract = mockContract({
        evaluate: async () => encoder.encode('{}'),
      });
      vi.spyOn(gateway, 'getContract').mockReturnValue(contract);

      await query('onboarding-cc', 'getOrganization', 'tata-001');
      expect(contract.submitTransaction).not.toHaveBeenCalled();
    });

    // A failed endorsement arrives as "failed to collect enough transaction
    // endorsements", with each peer's real reason in `details`. Surfacing only
    // the summary told a maker who tried to approve their own proposal nothing
    // at all — which is how this surfaced, in the maker-checker demo.
    it('surfaces the chaincode message behind an endorsement failure', async () => {
      const endorseError = Object.assign(
        new Error('10 ABORTED: failed to collect enough transaction endorsements'),
        {
          details: [
            { address: 'peer0.platform:10051', mspId: 'PlatformMSP',
              message: 'PO_ISSUE on PO-1 was proposed by this identity — a checker must be a different user (BR-09)' },
          ],
        },
      );
      const contract = mockContract({ evaluate: async () => { throw endorseError; } });
      vi.spyOn(gateway, 'getContract').mockReturnValue(contract);

      const err = await query('trade-doc-cc', 'issuePO', 'PO-1').catch((e: unknown) => e);
      expect((err as FabricError).message).toMatch(/a checker must be a different user/);
    });

    it('de-duplicates identical reasons from several peers', async () => {
      const endorseError = Object.assign(new Error('failed to collect enough endorsements'), {
        details: [
          { mspId: 'PlatformMSP', message: 'not a party to invoice INV-1' },
          { mspId: 'BuyerMSP', message: 'not a party to invoice INV-1' },
        ],
      });
      const contract = mockContract({ evaluate: async () => { throw endorseError; } });
      vi.spyOn(gateway, 'getContract').mockReturnValue(contract);

      const err = await query('trade-doc-cc', 'getInvoice', 'INV-1').catch((e: unknown) => e);
      expect((err as FabricError).message).toMatch(/Fabric trade-doc-cc.getInvoice: not a party to invoice INV-1$/);
    });

    it('falls back to the summary when there are no details', async () => {
      const contract = mockContract({
        evaluate: async () => { throw new Error('peer unreachable'); },
      });
      vi.spyOn(gateway, 'getContract').mockReturnValue(contract);

      const err = await query('trade-doc-cc', 'getInvoice', 'INV-1').catch((e: unknown) => e);
      expect((err as FabricError).message).toMatch(/peer unreachable/);
    });

    it('wraps not-found errors in FabricError', async () => {
      const contract = mockContract({
        evaluate: async () => { throw new Error('Organization missing-001 not found'); },
      });
      vi.spyOn(gateway, 'getContract').mockReturnValue(contract);

      const err = await query('onboarding-cc', 'getOrganization', 'missing-001').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(FabricError);
      expect((err as FabricError).message).toMatch(/not found/);
    });
  });
});
