// SPDX-License-Identifier: MIT
pragma solidity =0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

/**
 * @title CollateralVault
 * @notice Manages USDC collateral deposits and withdrawals for perpetual positions
 * @dev Uses immediate execution (not deferred) for collateral operations
 *      Only the clearing house can call deposit/withdraw functions
 */
contract CollateralVault {
    using SafeERC20 for IERC20;
    
    // ========== STATE VARIABLES ==========
    
    /// @notice The USDC token used as collateral
    IERC20 public immutable USDC;
    
    /// @notice The clearing house contract authorized to manage deposits/withdrawals
    address public clearingHouse;
    
    /// @notice Mapping of trader addresses to their USDC balance
    mapping(address => uint256) public balances;
    
    // ========== EVENTS ==========
    
    event Deposited(address indexed trader, uint256 amount);
    event Withdrawn(address indexed trader, uint256 amount);
    event ClearingHouseSet(address indexed clearingHouse);
    
    // ========== MODIFIERS ==========
    
    modifier onlyClearingHouse() {
        require(msg.sender == clearingHouse, "CollateralVault: Only clearing house");
        _;
    }
    
    // ========== CONSTRUCTOR ==========
    
    /**
     * @notice Initializes the CollateralVault with the USDC token address
     * @param _usdc Address of the USDC token contract
     */
    constructor(address _usdc) {
        require(_usdc != address(0), "CollateralVault: Zero address");
        USDC = IERC20(_usdc);
    }
    
    // ========== ADMIN FUNCTIONS ==========
    
    /**
     * @notice Sets the clearing house address (can only be set once)
     * @param _clearingHouse Address of the clearing house contract
     */
    function setClearingHouse(address _clearingHouse) external {
        require(clearingHouse == address(0), "CollateralVault: Already set");
        require(_clearingHouse != address(0), "CollateralVault: Zero address");
        clearingHouse = _clearingHouse;
        emit ClearingHouseSet(_clearingHouse);
    }
    
    // ========== EXTERNAL FUNCTIONS ==========
    
    /**
     * @notice Deposits USDC collateral for a trader
     * @dev Only callable by the clearing house
     * @param trader Address of the trader depositing collateral
     * @param amount Amount of USDC to deposit
     */
    function deposit(address trader, uint256 amount) external onlyClearingHouse {
        require(trader != address(0), "CollateralVault: Zero address");
        require(amount > 0, "CollateralVault: Zero amount");
        
        USDC.safeTransferFrom(trader, address(this), amount);
        balances[trader] += amount;
        
        emit Deposited(trader, amount);
    }
    
    /**
     * @notice Withdraws USDC collateral for a trader
     * @dev Only callable by the clearing house
     * @param trader Address of the trader withdrawing collateral
     * @param amount Amount of USDC to withdraw
     */
    function withdraw(address trader, uint256 amount) external onlyClearingHouse {
        require(trader != address(0), "CollateralVault: Zero address");
        require(amount > 0, "CollateralVault: Zero amount");
        require(balances[trader] >= amount, "CollateralVault: Insufficient balance");
        
        balances[trader] -= amount;
        USDC.safeTransfer(trader, amount);
        
        emit Withdrawn(trader, amount);
    }
    
    // ========== VIEW FUNCTIONS ==========
    
    /**
     * @notice Gets the USDC balance of a trader
     * @param trader Address of the trader
     * @return The USDC balance of the trader
     */
    function getBalance(address trader) external view returns (uint256) {
        return balances[trader];
    }
}
