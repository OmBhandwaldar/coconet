// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockUSDC
/// @notice Test fixture standing in for USDC/USDT on the Polygon Supernet (6 decimals).
/// @dev MVP settles escrow in USD via this mock. Production swaps it for a regulated
///      INR-pegged settlement token (deferred — see CLAUDE.md §2, §11).
contract MockUSDC is ERC20, Ownable {
    constructor(address initialOwner) ERC20("Mock USD Coin", "USDC") Ownable(initialOwner) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
