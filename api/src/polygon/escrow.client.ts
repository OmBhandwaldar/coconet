import { Contract } from 'ethers';
import { env } from '../config/env.js';
import { getSigner } from './provider.js';

// Human-readable ABIs — only the members the API/bridge use. Avoids depending on
// the contracts workspace build artifacts at runtime.
const FACTORY_ABI = [
  'function createEscrowInstruction(bytes32 escrowPaymentId, address buyer, address beneficiary, address token, uint256 amount, string linkedAssetId, uint256 expiryAt)',
  'function getEscrowInstruction(bytes32 escrowPaymentId) view returns (tuple(bytes32 escrowPaymentId, address buyer, address beneficiary, address token, uint256 amount, string linkedAssetId, uint256 expiryAt, bool exists))',
];

const VAULT_ABI = [
  'function fundEscrow(bytes32 escrowPaymentId)',
  'function markInvoiceApproved(bytes32 escrowPaymentId)',
  'function release(bytes32 escrowPaymentId)',
  'function refund(bytes32 escrowPaymentId)',
  'function getEscrow(bytes32 escrowPaymentId) view returns (tuple(address buyer, address beneficiary, address token, uint256 amount, string linkedAssetId, uint256 expiryAt, bool funded, bool invoiceApproved, uint8 status))',
  'event EscrowFunded(bytes32 indexed escrowPaymentId, uint256 amount)',
  'event FundsReleased(bytes32 indexed escrowPaymentId, address indexed beneficiary, uint256 amount)',
  'event FundsRefunded(bytes32 indexed escrowPaymentId, address indexed buyer, uint256 amount)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

export function factoryContract(): Contract {
  return new Contract(env.ESCROW_FACTORY_ADDRESS, FACTORY_ABI, getSigner());
}

export function vaultContract(): Contract {
  return new Contract(env.ESCROW_VAULT_ADDRESS, VAULT_ABI, getSigner());
}

export function usdcContract(): Contract {
  return new Contract(env.USDC_ADDRESS, ERC20_ABI, getSigner());
}
