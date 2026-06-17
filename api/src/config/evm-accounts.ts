// Static org → EVM address map for the MVP. Per-org on-chain wallets (Fabric CA /
// key management) are deferred to Ring 11; until then orgs map to well-known Hardhat
// accounts. The platform signer (account #0) executes all Polygon transactions and
// holds the minted USDC; buyer/beneficiary are the addresses escrow funds move between.
export const ORG_EVM_ADDRESS: Record<string, string> = {
  'platform-001': '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', // Hardhat #0 (signer)
  'tata-001': '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',     // Hardhat #1 (buyer)
  'bharat-001': '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',   // Hardhat #2 (supplier)
  'hdfc-001': '0x90F79bf6EB2c4f870365E785982E1f101E93b906',     // Hardhat #3 (lender/beneficiary)
};

export function evmAddressFor(orgId: string): string {
  const addr = ORG_EVM_ADDRESS[orgId];
  if (!addr) throw new Error(`No EVM address mapped for org ${orgId}`);
  return addr;
}
