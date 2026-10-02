import { beforeEach, describe, expect, it, vi } from 'vitest';

// A stateful vault mock: the handler reads the escrow to decide what is left to
// do, so marking has to flip the condition the way the contract does.
const escrow = { funded: true, invoiceApproved: false, status: 2n };
const vaultMock = {
  markInvoiceApproved: vi.fn(async () => {
    escrow.invoiceApproved = true;
    return { wait: async () => ({}) };
  }),
  release: vi.fn(async () => ({ wait: async () => ({}) })),
  getEscrow: vi.fn(async () => ({ ...escrow })),
};
vi.mock('../polygon/escrow.client.js', () => ({
  vaultContract: () => vaultMock,
  factoryContract: () => ({}),
  usdcContract: () => ({}),
}));

const { handleInvoiceApproved } = await import('../services/bridge.service.js');

beforeEach(() => {
  Object.assign(escrow, { funded: true, invoiceApproved: false, status: 2n });
  vaultMock.markInvoiceApproved.mockClear();
  vaultMock.release.mockClear();
});

describe('bridge: Fabric InvoiceApproved → Polygon', () => {
  it('marks the condition and releases when funded + approved', async () => {
    await handleInvoiceApproved('ESC-01', 'BS-INV-ESCROW-02');
    expect(vaultMock.markInvoiceApproved).toHaveBeenCalledTimes(1);
    expect(vaultMock.release).toHaveBeenCalledTimes(1);
  });

  it('marks the condition but does NOT release when the escrow is not yet funded', async () => {
    Object.assign(escrow, { funded: false, invoiceApproved: false, status: 1n });
    await handleInvoiceApproved('ESC-02', 'BS-INV-OTHER');
    expect(vaultMock.markInvoiceApproved).toHaveBeenCalledTimes(1);
    expect(vaultMock.release).not.toHaveBeenCalled();
  });
});
