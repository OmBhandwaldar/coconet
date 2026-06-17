import { expect } from 'chai';
import { ethers } from 'hardhat';

// Worked-example escrow: ₹2,47,50,000 invoice → $269,022 at ₹92 (USDC, 6 decimals).
const AMOUNT = 269022n * 1_000_000n;
const ID = ethers.keccak256(ethers.toUtf8Bytes('escrow-BS-INV-2024-1102'));
const LINKED = 'BS-INV-2024-1102';
const EXPIRY = 0n;

async function deploy() {
  const [platform, buyer, beneficiary] = await ethers.getSigners();
  const usdc = await (await ethers.getContractFactory('MockUSDC')).deploy(platform.address);
  const vault = await (await ethers.getContractFactory('EscrowVault')).deploy(platform.address);
  const factory = await (await ethers.getContractFactory('EscrowFactory')).deploy(platform.address);
  await vault.setFactory(await factory.getAddress());
  await factory.setVault(await vault.getAddress());
  // Fund the buyer with USDC and approve the vault.
  await usdc.mint(buyer.address, AMOUNT * 2n);
  await usdc.connect(buyer).approve(await vault.getAddress(), AMOUNT * 2n);
  return { platform, buyer, beneficiary, usdc, vault, factory };
}

async function open(factory: any, buyer: any, beneficiary: any, usdc: any) {
  return factory.createEscrowInstruction(
    ID, buyer.address, beneficiary.address, await usdc.getAddress(), AMOUNT, LINKED, EXPIRY,
  );
}

describe('EscrowVault', () => {
  it('factory opens an escrow visible in both factory and vault', async () => {
    const { factory, buyer, beneficiary, usdc, vault } = await deploy();
    await expect(open(factory, buyer, beneficiary, usdc))
      .to.emit(factory, 'EscrowInstructionCreated').withArgs(ID, beneficiary.address, AMOUNT, LINKED);
    const e = await vault.getEscrow(ID);
    expect(e.beneficiary).to.equal(beneficiary.address);
    expect(e.amount).to.equal(AMOUNT);
    expect(e.status).to.equal(1n); // Created
  });

  it('funds the escrow, pulling USDC into the vault (Rule-0A)', async () => {
    const { factory, buyer, beneficiary, usdc, vault } = await deploy();
    await open(factory, buyer, beneficiary, usdc);
    await expect(vault.connect(buyer).fundEscrow(ID)).to.emit(vault, 'EscrowFunded').withArgs(ID, AMOUNT);
    expect(await usdc.balanceOf(await vault.getAddress())).to.equal(AMOUNT);
    expect((await vault.getEscrow(ID)).status).to.equal(2n); // Funded
  });

  it('Rule-0A: cannot release before funding', async () => {
    const { factory, buyer, beneficiary, usdc, vault } = await deploy();
    await open(factory, buyer, beneficiary, usdc);
    await expect(vault.release(ID)).to.be.revertedWith('EscrowVault: not Funded');
  });

  it('Rule-0B: cannot release until the invoice-approved condition is set', async () => {
    const { factory, buyer, beneficiary, usdc, vault } = await deploy();
    await open(factory, buyer, beneficiary, usdc);
    await vault.connect(buyer).fundEscrow(ID);
    await expect(vault.release(ID)).to.be.revertedWith('EscrowVault: conditions not met');
  });

  it('releases to the beneficiary once funded + invoiceApproved', async () => {
    const { factory, buyer, beneficiary, usdc, vault } = await deploy();
    await open(factory, buyer, beneficiary, usdc);
    await vault.connect(buyer).fundEscrow(ID);
    await vault.markInvoiceApproved(ID);
    await expect(vault.release(ID)).to.emit(vault, 'FundsReleased').withArgs(ID, beneficiary.address, AMOUNT);
    expect(await usdc.balanceOf(beneficiary.address)).to.equal(AMOUNT);
    expect((await vault.getEscrow(ID)).status).to.equal(3n); // Released
  });

  it('cannot release twice', async () => {
    const { factory, buyer, beneficiary, usdc, vault } = await deploy();
    await open(factory, buyer, beneficiary, usdc);
    await vault.connect(buyer).fundEscrow(ID);
    await vault.markInvoiceApproved(ID);
    await vault.release(ID);
    await expect(vault.release(ID)).to.be.revertedWith('EscrowVault: not Funded');
  });

  it('Rule-0C: refunds the buyer before release', async () => {
    const { factory, buyer, beneficiary, usdc, vault } = await deploy();
    const before = await usdc.balanceOf(buyer.address);
    await open(factory, buyer, beneficiary, usdc);
    await vault.connect(buyer).fundEscrow(ID);
    await expect(vault.refund(ID)).to.emit(vault, 'FundsRefunded').withArgs(ID, buyer.address, AMOUNT);
    expect(await usdc.balanceOf(buyer.address)).to.equal(before);
    await expect(vault.release(ID)).to.be.revertedWith('EscrowVault: not Funded');
  });

  it('openEscrow is restricted to the factory', async () => {
    const { vault, buyer, beneficiary, usdc } = await deploy();
    await expect(
      vault.connect(buyer).openEscrow(ID, buyer.address, beneficiary.address, await usdc.getAddress(), AMOUNT, LINKED, EXPIRY),
    ).to.be.revertedWith('EscrowVault: caller is not the factory');
  });

  it('markInvoiceApproved is owner-only', async () => {
    const { factory, vault, buyer, beneficiary, usdc } = await deploy();
    await open(factory, buyer, beneficiary, usdc);
    await vault.connect(buyer).fundEscrow(ID);
    await expect(vault.connect(buyer).markInvoiceApproved(ID)).to.be.revertedWithCustomError(vault, 'OwnableUnauthorizedAccount');
  });

  it('rejects a duplicate instruction', async () => {
    const { factory, buyer, beneficiary, usdc } = await deploy();
    await open(factory, buyer, beneficiary, usdc);
    await expect(open(factory, buyer, beneficiary, usdc)).to.be.revertedWith('EscrowFactory: instruction exists');
  });

  it('openEscrow rejects amount = 0', async () => {
    const { factory, buyer, beneficiary, usdc } = await deploy();
    await expect(
      factory.createEscrowInstruction(ID, buyer.address, beneficiary.address, await usdc.getAddress(), 0n, LINKED, EXPIRY),
    ).to.be.revertedWith('EscrowVault: amount must be positive');
  });

  it('openEscrow rejects a zero beneficiary', async () => {
    const { factory, buyer, usdc } = await deploy();
    await expect(
      factory.createEscrowInstruction(ID, buyer.address, ethers.ZeroAddress, await usdc.getAddress(), AMOUNT, LINKED, EXPIRY),
    ).to.be.revertedWith('EscrowVault: zero address');
  });

  it('cannot fund twice', async () => {
    const { factory, buyer, beneficiary, usdc, vault } = await deploy();
    await open(factory, buyer, beneficiary, usdc);
    await vault.connect(buyer).fundEscrow(ID);
    await expect(vault.connect(buyer).fundEscrow(ID)).to.be.revertedWith('EscrowVault: not in Created');
  });

  it('markInvoiceApproved rejects a released escrow', async () => {
    const { factory, buyer, beneficiary, usdc, vault } = await deploy();
    await open(factory, buyer, beneficiary, usdc);
    await vault.connect(buyer).fundEscrow(ID);
    await vault.markInvoiceApproved(ID);
    await vault.release(ID);
    await expect(vault.markInvoiceApproved(ID)).to.be.revertedWith('EscrowVault: bad status');
  });

  it('refund rejects an unfunded escrow', async () => {
    const { factory, buyer, beneficiary, usdc, vault } = await deploy();
    await open(factory, buyer, beneficiary, usdc);
    await expect(vault.refund(ID)).to.be.revertedWith('EscrowVault: not Funded');
  });

  it('getEscrow reverts for an unknown id', async () => {
    const { vault } = await deploy();
    await expect(vault.getEscrow(ethers.keccak256(ethers.toUtf8Bytes('nope')))).to.be.revertedWith('EscrowVault: not found');
  });
});
