// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title VirtualToken
 * @notice Minimal ERC20 token for virtual assets in perpetual exchange
 * @dev
 *  - Virtual tokens (vETH, vUSDC) are not backed by real assets
 *  - Used purely for position tracking in the perpetual protocol
 *  - Minted/burned on demand during position changes
 *  - Whitelisted addresses (NettingEngine, Pool) can mint/burn
 *  - Owner has unlimited supply initially (for pool initialization)
 */
contract VirtualToken is ERC20, Ownable {
    
    /// @notice Addresses authorized to mint/burn tokens
    mapping(address => bool) public whitelist;
    
    /// @notice Emitted when an address is added to whitelist
    event WhitelistAdded(address indexed account);
    
    /// @notice Emitted when an address is removed from whitelist
    event WhitelistRemoved(address indexed account);
    
    /**
     * @notice Creates a new virtual token
     * @param name Token name (e.g., "Virtual ETH")
     * @param symbol Token symbol (e.g., "vETH")
     * @dev Mints max uint256 supply to deployer for initial pool setup
     */
    constructor(string memory name, string memory symbol) 
        ERC20(name, symbol) 
    {
        // Mint infinite supply to owner for initial pool liquidity
        // This allows owner to add liquidity without minting constraints
        _mint(msg.sender, type(uint256).max);
    }
    
    /**
     * @notice Adds an address to the whitelist
     * @param account Address to whitelist
     * @dev Only owner can whitelist. Typically: NettingEngine, Pools
     */
    function addToWhitelist(address account) external onlyOwner {
        require(account != address(0), "VirtualToken: zero address");
        require(!whitelist[account], "VirtualToken: already whitelisted");
        
        whitelist[account] = true;
        emit WhitelistAdded(account);
    }
    
    /**
     * @notice Removes an address from the whitelist
     * @param account Address to remove
     * @dev Only owner can remove from whitelist
     */
    function removeFromWhitelist(address account) external onlyOwner {
        require(whitelist[account], "VirtualToken: not whitelisted");
        
        whitelist[account] = false;
        emit WhitelistRemoved(account);
    }
    
    /**
     * @notice Mints tokens to a specified address
     * @param to Recipient address
     * @param amount Amount to mint
     * @dev Only whitelisted addresses can mint. Used during position opening.
     */
    function mint(address to, uint256 amount) external {
        require(whitelist[msg.sender], "VirtualToken: not whitelisted");
        require(to != address(0), "VirtualToken: mint to zero address");
        
        _mint(to, amount);
    }
    
    /**
     * @notice Burns tokens from a specified address
     * @param from Address to burn from
     * @param amount Amount to burn
     * @dev Only whitelisted addresses can burn. Used during position closing.
     */
    function burn(address from, uint256 amount) external {
        require(whitelist[msg.sender], "VirtualToken: not whitelisted");
        require(from != address(0), "VirtualToken: burn from zero address");
        
        _burn(from, amount);
    }
    
    /**
     * @notice Checks if an address is whitelisted
     * @param account Address to check
     * @return True if whitelisted, false otherwise
     */
    function isWhitelisted(address account) external view returns (bool) {
        return whitelist[account];
    }
}
