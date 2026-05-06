import { expect } from 'chai';
import { ethers } from 'hardhat';

describe('EscrowFactory', () => {
  it('deploys and sets owner', async () => {
    const [owner] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory('EscrowFactory');
    const factory = await Factory.deploy(owner.address);
    await factory.waitForDeployment();
    expect(await factory.owner()).to.equal(owner.address);
  });

  it('emits EscrowInstructionCreated on createEscrowInstruction', async () => {
    const [owner, beneficiary] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory('EscrowFactory');
    const factory = await Factory.deploy(owner.address);
    await factory.waitForDeployment();

    const id = ethers.keccak256(ethers.toUtf8Bytes('test-escrow-001'));
    await expect(factory.createEscrowInstruction(id, beneficiary.address, ethers.parseEther('1')))
      .to.emit(factory, 'EscrowInstructionCreated')
      .withArgs(id, ethers.ZeroAddress);
  });
});
