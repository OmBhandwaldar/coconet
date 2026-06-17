import { beforeEach, describe, expect, it, vi } from 'vitest';

// Stable vault mock so we can assert the bridge's cross-chain calls.
const vaultMock = {
  markInvoiceApproved: vi.fn(async () => ({ wait: async () => ({}) })),
  release: vi.fn(async () => ({ wait: async () => ({}) })),
  getEscrow: vi.fn(async () => ({ funded: true, invoiceApproved: true, status: 2n })),
};
vi.mock('../polygon/escrow.client.js', () => ({
  vaultContract: () => vaultMock,
  factoryContract: () => ({}),
  usdcContract: () => ({}),
}));

const { handleInvoiceApproved } = await import('../services/bridge.service.js');

beforeEach(() => {
  vaultMock.markInvoiceApproved.mockClear();
  vaultMock.release.mockClear();
});

describe('bridge: Fabric InvoiceApproved → Polygon', () => {
  it('marks the condition and releases when funded + approved', async () => {
    vaultMock.getEscrow.mockResolvedValueOnce({ funded: true, invoiceApproved: true, status: 2n });
    await handleInvoiceApproved('ESC-01', 'BS-INV-ESCROW-02');
    expect(vaultMock.markInvoiceApproved).toHaveBeenCalledTimes(1);
    expect(vaultMock.release).toHaveBeenCalledTimes(1);
  });

  it('marks the condition but does NOT release when the escrow is not yet funded', async () => {
    vaultMock.getEscrow.mockResolvedValueOnce({ funded: false, invoiceApproved: true, status: 1n });
    await handleInvoiceApproved('ESC-02', 'BS-INV-OTHER');
    expect(vaultMock.markInvoiceApproved).toHaveBeenCalledTimes(1);
    expect(vaultMock.release).not.toHaveBeenCalled();
  });
});
