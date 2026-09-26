import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const HARDHAT_ACCOUNT_0 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

async function loadSecrets(nodeEnv: string) {
  vi.resetModules();
  process.env.NODE_ENV = nodeEnv;
  return import('../config/secrets.js');
}

afterEach(() => { process.env.NODE_ENV = 'test'; vi.resetModules(); });

describe('secret resolution', () => {
  it('reads from the environment', async () => {
    process.env.TEST_SECRET = 'from-env';
    const { getSecret } = await loadSecrets('development');
    expect(getSecret('TEST_SECRET')).toBe('from-env');
    delete process.env.TEST_SECRET;
  });

  // How Docker and Kubernetes mount secrets — the file wins over the env var so
  // a stale environment value cannot silently take precedence.
  it('prefers a mounted secret file over the environment', async () => {
    const file = path.join(os.tmpdir(), `coconet-secret-${Date.now()}`);
    fs.writeFileSync(file, 'from-file\n');
    process.env.TEST_SECRET = 'from-env';
    process.env.TEST_SECRET_FILE = file;
    const { getSecret } = await loadSecrets('development');
    expect(getSecret('TEST_SECRET')).toBe('from-file');
    delete process.env.TEST_SECRET;
    delete process.env.TEST_SECRET_FILE;
    fs.unlinkSync(file);
  });

  it('throws when a required secret is absent', async () => {
    const { getSecret, SecretError } = await loadSecrets('development');
    expect(() => getSecret('DEFINITELY_NOT_SET')).toThrow(SecretError);
  });

  it('tolerates an absent optional secret', async () => {
    const { getSecret } = await loadSecrets('development');
    expect(getSecret('DEFINITELY_NOT_SET', { required: false })).toBe('');
  });

  // The failure this exists to prevent: shipping with Hardhat's account #0,
  // which is published in their docs. Anyone who knows it can drain whatever
  // it controls.
  it('refuses a publicly known development key in production', async () => {
    process.env.TEST_SECRET = HARDHAT_ACCOUNT_0;
    const { getSecret, SecretError } = await loadSecrets('production');
    expect(() => getSecret('TEST_SECRET')).toThrow(SecretError);
    delete process.env.TEST_SECRET;
  });

  it('allows that same key outside production', async () => {
    process.env.TEST_SECRET = HARDHAT_ACCOUNT_0;
    const { getSecret } = await loadSecrets('development');
    expect(getSecret('TEST_SECRET')).toBe(HARDHAT_ACCOUNT_0);
    delete process.env.TEST_SECRET;
  });
});
