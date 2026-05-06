// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @dev Placeholder stub — full implementation in Block 5.
contract EscrowFactory is Ownable {
    event EscrowInstructionCreated(bytes32 indexed escrowPaymentId, address indexed vault);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function createEscrowInstruction(
        bytes32 escrowPaymentId,
        address beneficiary,
        uint256 amount
    ) external onlyOwner returns (address vault) {
        // Stub — returns zero address until EscrowVault is implemented in Block 5.
        emit EscrowInstructionCreated(escrowPaymentId, address(0));
        return address(0);
    }
}
