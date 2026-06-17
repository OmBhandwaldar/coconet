import { expect } from 'chai';
import { ethers } from 'hardhat';

describe('EscrowFactory', () => {
  async function deploy() {
    const [owner, buyer, beneficiary] = await ethers.getSigners();
    const usdc = await (await ethers.getContractFactory('MockUSDC')).deploy(owner.address);
    const vault = await (await ethers.getContractFactory('EscrowVault')).deploy(owner.address);
    const factory = await (await ethers.getContractFactory('EscrowFactory')).deploy(owner.address);
    await vault.setFactory(await factory.getAddress());
    await factory.setVault(await vault.getAddress());
    return { owner, buyer, beneficiary, usdc, vault, factory };
  }

  it('deploys and sets owner', async () => {
    const { owner, factory } = await deploy();
    expect(await factory.owner()).to.equal(owner.address);
  });

  it('reverts createEscrowInstruction when the vault is unset', async () => {
    const [owner, buyer, beneficiary] = await ethers.getSigners();
    const usdc = await (await ethers.getContractFactory('MockUSDC')).deploy(owner.address);
    const factory = await (await ethers.getContractFactory('EscrowFactory')).deploy(owner.address);
    const id = ethers.keccak256(ethers.toUtf8Bytes('no-vault'));
    await expect(
      factory.createEscrowInstruction(id, buyer.address, beneficiary.address, await usdc.getAddress(), 1n, 'INV', 0n),
    ).to.be.revertedWith('EscrowFactory: vault not set');
  });

  it('records the instruction and lists it by buyer', async () => {
    const { factory, buyer, beneficiary, usdc } = await deploy();
    const id = ethers.keccak256(ethers.toUtf8Bytes('test-escrow-001'));
    await factory.createEscrowInstruction(id, buyer.address, beneficiary.address, await usdc.getAddress(), 1000n, 'INV', 0n);
    const inst = await factory.getEscrowInstruction(id);
    expect(inst.beneficiary).to.equal(beneficiary.address);
    expect(inst.amount).to.equal(1000n);
    expect(await factory.listByBuyer(buyer.address)).to.deep.equal([id]);
  });

  it('createEscrowInstruction is owner-only', async () => {
    const { factory, buyer, beneficiary, usdc } = await deploy();
    const id = ethers.keccak256(ethers.toUtf8Bytes('test-escrow-002'));
    await expect(
      factory.connect(buyer).createEscrowInstruction(id, buyer.address, beneficiary.address, await usdc.getAddress(), 1000n, 'INV', 0n),
    ).to.be.revertedWithCustomError(factory, 'OwnableUnauthorizedAccount');
  });
});
