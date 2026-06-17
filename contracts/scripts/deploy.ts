import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

// Deploys MockUSDC + EscrowVault + EscrowFactory to the target network, wires them,
// and mints USDC to the platform signer (the API funder). Prints the addresses to copy
// into the API .env (USDC_ADDRESS / ESCROW_VAULT_ADDRESS / ESCROW_FACTORY_ADDRESS).
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deployer (platform signer):', deployer.address);

  const USDC = await ethers.getContractFactory('MockUSDC');
  const usdc = await USDC.deploy(deployer.address);
  await usdc.waitForDeployment();

  const Vault = await ethers.getContractFactory('EscrowVault');
  const vault = await Vault.deploy(deployer.address);
  await vault.waitForDeployment();

  const Factory = await ethers.getContractFactory('EscrowFactory');
  const factory = await Factory.deploy(deployer.address);
  await factory.waitForDeployment();

  // Wire factory <-> vault.
  await (await vault.setFactory(await factory.getAddress())).wait();
  await (await factory.setVault(await vault.getAddress())).wait();

  // Mint 1,000,000 USDC (6 decimals) to the platform signer to fund escrows.
  await (await usdc.mint(deployer.address, 1_000_000_000_000n)).wait();

  const out = {
    USDC_ADDRESS: await usdc.getAddress(),
    ESCROW_VAULT_ADDRESS: await vault.getAddress(),
    ESCROW_FACTORY_ADDRESS: await factory.getAddress(),
  };
  console.log('\nDeployed addresses (copy into .env):');
  for (const [k, v] of Object.entries(out)) console.log(`${k}=${v}`);

  fs.writeFileSync(path.join(__dirname, '..', 'deployments.local.json'), JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
