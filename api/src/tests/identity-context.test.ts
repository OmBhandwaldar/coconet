import { describe, it, expect } from 'vitest';
import { runAs, currentCaller, currentWalletLabel } from '../auth/identity-context.js';
import { issueToken } from '../auth/jwt.js';
import { findUser } from '../auth/users.js';

function claimsFor(username: string) {
  return issueToken(findUser(username)!).claims;
}

describe('caller identity context', () => {
  it('is empty outside a request — background work uses the platform identity', () => {
    expect(currentCaller()).toBeUndefined();
    expect(currentWalletLabel()).toBeUndefined();
  });

  it('carries the caller through synchronous calls', () => {
    runAs(claimsFor('rajesh'), () => {
      expect(currentCaller()?.sub).toBe('rajesh');
      expect(currentWalletLabel()).toBe('User1@buyer');
    });
  });

  // The reason this exists: a Fabric submit is several awaits deep inside a
  // service. If the context did not survive those, every transaction would
  // silently fall back to the platform identity and attribution would be lost.
  it('survives await boundaries', async () => {
    await runAs(claimsFor('kavitha'), async () => {
      await new Promise((r) => setTimeout(r, 5));
      expect(currentWalletLabel()).toBe('User2@supplier');
      await new Promise((r) => setTimeout(r, 5));
      expect(currentCaller()?.msp_id).toBe('SupplierMSP');
    });
  });

  it('keeps concurrent callers separate', async () => {
    const seen: string[] = [];
    await Promise.all([
      runAs(claimsFor('rajesh'), async () => {
        await new Promise((r) => setTimeout(r, 10));
        seen.push(currentWalletLabel()!);
      }),
      runAs(claimsFor('amit'), async () => {
        await new Promise((r) => setTimeout(r, 2));
        seen.push(currentWalletLabel()!);
      }),
    ]);
    expect(seen.sort()).toEqual(['User1@buyer', 'User1@lender']);
  });

  it('does not leak out of its scope', () => {
    runAs(claimsFor('priya'), () => expect(currentWalletLabel()).toBe('User2@buyer'));
    expect(currentWalletLabel()).toBeUndefined();
  });
});
