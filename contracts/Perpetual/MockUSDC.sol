// SPDX-License-Identifier: MIT
pragma solidity =0.7.6;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @notice Simple mock USDC token for testing purposes
 */
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {
        // Mint initial supply to deployer for testing
        _mint(msg.sender, 1000000 * 10**18); // 1M USDC
    }
    
    /**
     * @notice Mint tokens to any address (only for testing)
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
