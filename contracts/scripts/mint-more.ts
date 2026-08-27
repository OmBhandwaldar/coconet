import { ethers } from 'hardhat';
import * as fs from 'fs';

// Top up the demo buyer's MockUSDC when escrow funding fails with
// ERC20InsufficientBalance (the deploy mint runs out after many demo deals).
//   npx hardhat run scripts/mint-more.ts --network localhost
const AMOUNT = 10_000_000_000_000n; // 10,000,000 USDC (6 decimals)

async function main() {
  const dep = JSON.parse(fs.readFileSync('deployments.local.json', 'utf8'));
  const [signer] = await ethers.getSigners();
  const usdc = await ethers.getContractAt('MockUSDC', dep.USDC_ADDRESS, signer);
  const before = await usdc.balanceOf(signer.address);
  await (await usdc.mint(signer.address, AMOUNT)).wait();
  const after = await usdc.balanceOf(signer.address);
  console.log('address:', signer.address);
  console.log('before :', (Number(before) / 1e6).toLocaleString(), 'USDC');
  console.log('after  :', (Number(after) / 1e6).toLocaleString(), 'USDC');
}

main().catch((e) => { console.error(e); process.exit(1); });
