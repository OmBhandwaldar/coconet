// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./EscrowVault.sol";

/// @title EscrowFactory
/// @notice Entry point that records escrow payment instructions and opens them in the EscrowVault.
/// @dev MVP: Prefunded funding + Invoice-linked only. owner == the platform signer.
contract EscrowFactory is Ownable {
    struct Instruction {
        bytes32 escrowPaymentId;
        address buyer;
        address beneficiary;
        address token;
        uint256 amount;
        string linkedAssetId;
        uint256 expiryAt;
        bool exists;
    }

    EscrowVault public vault;
    mapping(bytes32 => Instruction) private instructions;
    mapping(address => bytes32[]) private byBuyer;

    event EscrowInstructionCreated(
        bytes32 indexed escrowPaymentId,
        address indexed beneficiary,
        uint256 amount,
        string linkedAssetId
    );

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setVault(address v) external onlyOwner {
        vault = EscrowVault(v);
    }

    function createEscrowInstruction(
        bytes32 escrowPaymentId,
        address buyer,
        address beneficiary,
        address token,
        uint256 amount,
        string calldata linkedAssetId,
        uint256 expiryAt
    ) external onlyOwner {
        require(!instructions[escrowPaymentId].exists, "EscrowFactory: instruction exists");
        require(address(vault) != address(0), "EscrowFactory: vault not set");
        instructions[escrowPaymentId] = Instruction({
            escrowPaymentId: escrowPaymentId,
            buyer: buyer,
            beneficiary: beneficiary,
            token: token,
            amount: amount,
            linkedAssetId: linkedAssetId,
            expiryAt: expiryAt,
            exists: true
        });
        byBuyer[buyer].push(escrowPaymentId);
        vault.openEscrow(escrowPaymentId, buyer, beneficiary, token, amount, linkedAssetId, expiryAt);
        emit EscrowInstructionCreated(escrowPaymentId, beneficiary, amount, linkedAssetId);
    }

    function getEscrowInstruction(bytes32 escrowPaymentId) external view returns (Instruction memory) {
        require(instructions[escrowPaymentId].exists, "EscrowFactory: not found");
        return instructions[escrowPaymentId];
    }

    function listByBuyer(address buyer) external view returns (bytes32[] memory) {
        return byBuyer[buyer];
    }
}
