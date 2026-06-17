// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title EscrowVault
/// @notice Holds escrowed ERC-20 funds and releases them only when all conditions are met.
/// @dev MVP scope: Prefunded model, two inline release conditions (funded + invoiceApproved).
///      FundingManager (Rule-0A models) and ReleaseConditionEvaluator (full 6 conditions, Rule-0B)
///      are extracted in Rings 6/7. owner == the bridge/platform signer.
contract EscrowVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status { None, Created, Funded, Released, Refunded }

    struct Escrow {
        address buyer;
        address beneficiary;
        address token;
        uint256 amount;
        string linkedAssetId;
        uint256 expiryAt;
        bool funded;          // Rule-0A: no release until funded
        bool invoiceApproved; // release condition flipped by the bridge on Fabric InvoiceApproved
        Status status;
    }

    address public factory;
    mapping(bytes32 => Escrow) private escrows;

    event EscrowOpened(bytes32 indexed escrowPaymentId, address indexed beneficiary, uint256 amount, string linkedAssetId);
    event EscrowFunded(bytes32 indexed escrowPaymentId, uint256 amount);
    event ConditionUpdated(bytes32 indexed escrowPaymentId, string condition, bool value);
    event FundsReleased(bytes32 indexed escrowPaymentId, address indexed beneficiary, uint256 amount);
    event FundsRefunded(bytes32 indexed escrowPaymentId, address indexed buyer, uint256 amount);

    constructor(address initialOwner) Ownable(initialOwner) {}

    modifier onlyFactory() {
        require(msg.sender == factory, "EscrowVault: caller is not the factory");
        _;
    }

    function setFactory(address f) external onlyOwner {
        factory = f;
    }

    /// @notice Open an escrow slot. Called by EscrowFactory on instruction creation.
    function openEscrow(
        bytes32 escrowPaymentId,
        address buyer,
        address beneficiary,
        address token,
        uint256 amount,
        string calldata linkedAssetId,
        uint256 expiryAt
    ) external onlyFactory {
        require(escrows[escrowPaymentId].status == Status.None, "EscrowVault: escrow exists");
        require(beneficiary != address(0) && token != address(0), "EscrowVault: zero address");
        require(amount > 0, "EscrowVault: amount must be positive");
        escrows[escrowPaymentId] = Escrow({
            buyer: buyer,
            beneficiary: beneficiary,
            token: token,
            amount: amount,
            linkedAssetId: linkedAssetId,
            expiryAt: expiryAt,
            funded: false,
            invoiceApproved: false,
            status: Status.Created
        });
        emit EscrowOpened(escrowPaymentId, beneficiary, amount, linkedAssetId);
    }

    /// @notice Fund the escrow by pulling ERC-20 from the caller (Prefunded — Rule-0A).
    function fundEscrow(bytes32 escrowPaymentId) external nonReentrant {
        Escrow storage e = escrows[escrowPaymentId];
        require(e.status == Status.Created, "EscrowVault: not in Created");
        e.funded = true;
        e.status = Status.Funded;
        IERC20(e.token).safeTransferFrom(msg.sender, address(this), e.amount);
        emit EscrowFunded(escrowPaymentId, e.amount);
    }

    /// @notice Bridge flips the invoice-approved condition (owner == bridge signer).
    function markInvoiceApproved(bytes32 escrowPaymentId) external onlyOwner {
        Escrow storage e = escrows[escrowPaymentId];
        require(e.status == Status.Created || e.status == Status.Funded, "EscrowVault: bad status");
        e.invoiceApproved = true;
        emit ConditionUpdated(escrowPaymentId, "invoiceApproved", true);
    }

    /// @notice Release to the beneficiary. Permissionless once ALL conditions hold (Rule-0B).
    function release(bytes32 escrowPaymentId) external nonReentrant {
        Escrow storage e = escrows[escrowPaymentId];
        require(e.status == Status.Funded, "EscrowVault: not Funded");
        require(e.funded, "EscrowVault: not funded");                  // Rule-0A
        require(e.invoiceApproved, "EscrowVault: conditions not met");  // Rule-0B
        e.status = Status.Released;
        IERC20(e.token).safeTransfer(e.beneficiary, e.amount);
        emit FundsReleased(escrowPaymentId, e.beneficiary, e.amount);
    }

    /// @notice Refund the buyer before release (Rule-0C — dispute/cancel priority).
    function refund(bytes32 escrowPaymentId) external onlyOwner nonReentrant {
        Escrow storage e = escrows[escrowPaymentId];
        require(e.status == Status.Funded, "EscrowVault: not Funded");
        e.status = Status.Refunded;
        IERC20(e.token).safeTransfer(e.buyer, e.amount);
        emit FundsRefunded(escrowPaymentId, e.buyer, e.amount);
    }

    function getEscrow(bytes32 escrowPaymentId) external view returns (Escrow memory) {
        require(escrows[escrowPaymentId].status != Status.None, "EscrowVault: not found");
        return escrows[escrowPaymentId];
    }
}
