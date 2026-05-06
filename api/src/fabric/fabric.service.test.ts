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
    evaluateTransaction: vi.fn(overrides.evaluate ?? (async () => encoder.encode(''))),
  } as any;
}

afterEach(() => vi.restoreAllMocks());

describe('fabric.service', () => {
  describe('invoke', () => {
    it('parses JSON object response', async () => {
      const contract = mockContract({
        submit: async () => encoder.encode('{"org_id":"tata-001","status":"Pending"}'),
      });
      vi.spyOn(gateway, 'getContract').mockReturnValue(contract);

      const result = await invoke('onboarding-cc', 'createOrganization', '{"org_id":"tata-001"}');
      expect(result).toEqual({ org_id: 'tata-001', status: 'Pending' });
      expect(contract.submitTransaction).toHaveBeenCalledWith('createOrganization', '{"org_id":"tata-001"}');
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

    it('wraps not-found errors in FabricError', async () => {
      const contract = mockContract({
        evaluate: async () => { throw new Error('Organization missing-001 not found'); },
      });
      vi.spyOn(gateway, 'getContract').mockReturnValue(contract);

      const err = await query('onboarding-cc', 'getOrganization', 'missing-001').catch((e) => e);
      expect(err).toBeInstanceOf(FabricError);
      expect(err.message).toMatch(/not found/);
    });
  });
});
