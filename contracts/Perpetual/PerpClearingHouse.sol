// SPDX-License-Identifier: MIT
pragma solidity =0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "./CollateralVault.sol";
import "./PositionTracker.sol";
import "./PerpNettingEngine.sol";
import "./VirtualToken.sol";
import "@uniswap/v3-core/contracts/interfaces/pool/IUniswapV3PoolState.sol";

/**
 * @title PerpClearingHouse
 * @notice Main user interface for perpetual futures trading
 * @dev
 *  IMMEDIATE OPERATIONS (Direct execution):
 *  - deposit(): Transfer USDC to CollateralVault
 *  - withdraw(): Check margin, transfer USDC from vault
 *
 *  QUEUED OPERATIONS (Deferred batch execution):
 *  - openPosition(): Queue via PerpNettingEngine
 *  - closePosition(): Queue via PerpNettingEngine
 *
 *  KEY FEATURES:
 *  - 10% maintenance margin = 10x leverage
 *  - Margin checked at queue time and validated during execution
 *  - Virtual tokens (vETH/vUSDC) minted/burned via PerpNettingEngine
 *  - Position tracking via PositionTracker (concurrent container)
 */
contract PerpClearingHouse {
    using SafeERC20 for IERC20;
    
    // ========== STATE VARIABLES ==========
    
    /// @notice Position tracker for managing user positions
    PositionTracker public immutable positionTracker;
    
    /// @notice Collateral vault for USDC deposits/withdrawals
    CollateralVault public immutable vault;
    
    /// @notice Perpetual netting engine for queued operations
    PerpNettingEngine public immutable perpNettingEngine;
    
    /// @notice Uniswap V3 pool for vETH/vUSDC
    IUniswapV3PoolState public immutable pool;
    
    /// @notice Virtual ETH token
    VirtualToken public immutable vETH;
    
    /// @notice Virtual USDC token
    VirtualToken public immutable vUSDC;
    
    /// @notice Real USDC token for collateral
    IERC20 public immutable USDC;
    
    /// @notice Maintenance margin ratio (10% = 10x leverage)
    uint256 public constant MARGIN_RATIO = 10;
    
    /// @notice Precision for calculations
    uint256 public constant PRECISION = 100;
    
    /// @notice Pool fee tier (0.3%)
    uint24 public constant POOL_FEE = 3000;
    
    // Flag to track if vETH is token0 in the pool (for price calculation)
    bool private immutable isVETHToken0;
    
    // ========== EVENTS ==========
    
    event Deposited(address indexed trader, uint256 amount);
    event Withdrawn(address indexed trader, uint256 amount);
    event PositionOpenQueued(address indexed trader, bool isLong, uint256 size);
    event PositionCloseQueued(address indexed trader, bool isLong, uint256 size);
    
    // ========== CONSTRUCTOR ==========
    
    /**
     * @notice Initializes the PerpClearingHouse
     * @param _positionTracker Address of PositionTracker contract
     * @param _vault Address of CollateralVault contract
     * @param _perpNettingEngine Address of PerpNettingEngine contract
     * @param _pool Address of vETH/vUSDC Uniswap V3 pool
     * @param _vETH Address of virtual ETH token
     * @param _vUSDC Address of virtual USDC token
     * @param _usdc Address of real USDC token
     */
    constructor(
        address _positionTracker,
        address _vault,
        address _perpNettingEngine,
        address _pool,
        address _vETH,
        address _vUSDC,
        address _usdc
    ) {
        require(_positionTracker != address(0), "Invalid positionTracker");
        require(_vault != address(0), "Invalid vault");
        require(_perpNettingEngine != address(0), "Invalid perpNettingEngine");
        require(_pool != address(0), "Invalid pool");
        require(_vETH != address(0), "Invalid vETH");
        require(_vUSDC != address(0), "Invalid vUSDC");
        require(_usdc != address(0), "Invalid usdc");
        
        positionTracker = PositionTracker(_positionTracker);
        vault = CollateralVault(_vault);
        perpNettingEngine = PerpNettingEngine(_perpNettingEngine);
        pool = IUniswapV3PoolState(_pool);
        vETH = VirtualToken(_vETH);
        vUSDC = VirtualToken(_vUSDC);
        USDC = IERC20(_usdc);
        
        // Determine token ordering for price calculation
        // Use low-level call to avoid interface issues
        (bool success, bytes memory data) = _pool.staticcall(abi.encodeWithSignature("token0()"));
        require(success, "Failed to get token0");
        address token0 = abi.decode(data, (address));
        isVETHToken0 = (token0 == _vETH);
    }
    
    // ========== IMMEDIATE OPERATIONS ==========
    
    /**
     * @notice Deposits USDC collateral into the vault
     * @dev IMMEDIATE execution - transfers USDC from user to vault
     * @param amount Amount of USDC to deposit
     */
    function deposit(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        
        // Transfer USDC directly from user to vault
        USDC.safeTransferFrom(msg.sender, address(vault), amount);
        
        // Update vault balance
        vault.deposit(msg.sender, amount);
        
        emit Deposited(msg.sender, amount);
    }
    
    /**
     * @notice Withdraws USDC collateral from the vault
     * @dev IMMEDIATE execution - checks margin before withdrawal
     * @param amount Amount of USDC to withdraw
     */
    function withdraw(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        
        // Check that withdrawal doesn't violate margin requirements
        uint256 freeCollateral = getFreeCollateral(msg.sender);
        require(amount <= freeCollateral, "Insufficient free collateral");
        
        // Withdraw from vault to user
        vault.withdraw(msg.sender, amount);
        
        emit Withdrawn(msg.sender, amount);
    }
    
    // ========== QUEUED OPERATIONS ==========
    
    /**
     * @notice Opens a new position (long or short)
     * @dev QUEUED execution - request stored and processed in deferred batch
     * @param isLong True = long (buy vETH), False = short (sell vETH)
     * @param size Position size in base token terms (vETH)
     */
    function openPosition(bool isLong, uint256 size) external {
        require(size > 0, "Size must be > 0");
        
        // Calculate notional value and check margin
        uint256 notionalValue = (size * getMarkPrice()) / 1e18;
        uint256 requiredMargin = (notionalValue * MARGIN_RATIO) / PRECISION;
        require(vault.balances(msg.sender) >= requiredMargin, "Insufficient collateral for position");
        
        // Queue position change based on direction
        if (isLong) {
            // Long: vUSDC → vETH
            perpNettingEngine.queuePositionChange(
                address(pool),
                address(vUSDC),
                address(vETH),
                POOL_FEE,
                notionalValue,
                0,
                size,
                true,
                true
            );
        } else {
            // Short: vETH → vUSDC
            perpNettingEngine.queuePositionChange(
                address(pool),
                address(vETH),
                address(vUSDC),
                POOL_FEE,
                size,
                0,
                notionalValue,
                true,
                false
            );
        }
        
        emit PositionOpenQueued(msg.sender, isLong, size);
    }
    
    /**
     * @notice Closes an existing position
     * @dev QUEUED execution - reverses the position direction
     * @param size Amount to close (0 = close entire position)
     */
    function closePosition(uint256 size) external {
        // Get current position
        (int256 baseBalance, , ) = positionTracker.getPosition(msg.sender);
        require(baseBalance != 0, "No position to close");
        
        // Determine if closing long or short
        bool isClosingLong = baseBalance > 0;
        
        // Calculate close size
        uint256 closeSize;
        if (size == 0) {
            closeSize = isClosingLong ? uint256(baseBalance) : uint256(-baseBalance);
        } else {
            uint256 positionSize = isClosingLong ? uint256(baseBalance) : uint256(-baseBalance);
            require(size <= positionSize, "Close size exceeds position");
            closeSize = size;
        }
        
        // Calculate notional value
        uint256 notionalValue = (closeSize * getMarkPrice()) / 1e18;
        
        // Queue position change (token directions opposite of opening)
        if (isClosingLong) {
            // Closing long: vETH → vUSDC
            perpNettingEngine.queuePositionChange(
                address(pool),
                address(vETH),
                address(vUSDC),
                POOL_FEE,
                closeSize,
                0,
                notionalValue,
                false,
                false // Opposite of long
            );
        } else {
            // Closing short: vUSDC → vETH
            perpNettingEngine.queuePositionChange(
                address(pool),
                address(vUSDC),
                address(vETH),
                POOL_FEE,
                notionalValue,
                0,
                closeSize,
                false,
                true // Opposite of short
            );
        }
        
        emit PositionCloseQueued(msg.sender, isClosingLong, closeSize);
    }
    
    // ========== VIEW FUNCTIONS ==========
    
    /**
     * @notice Calculates free collateral available for withdrawal or new positions
     * @dev freeCollateral = totalCollateral - requiredMargin
     * @param trader Address of the trader
     * @return Free collateral amount in USDC
     */
    function getFreeCollateral(address trader) public returns (uint256) {
        uint256 collateral = vault.balances(trader);
        
        // Get position value
        int256 positionValue = getPositionValue(trader);
        
        // If no position, all collateral is free
        if (positionValue == 0) {
            return collateral;
        }
        
        // Calculate required margin (10% of absolute position value)
        uint256 absPositionValue = positionValue > 0 ? uint256(positionValue) : uint256(-positionValue);
        uint256 requiredMargin = (absPositionValue * MARGIN_RATIO) / PRECISION;
        
        // Free collateral = total - required
        if (requiredMargin >= collateral) {
            return 0; // Under-margined (should not happen if checks work)
        }
        
        return collateral - requiredMargin;
    }
    
    /**
     * @notice Gets the current position value for a trader
     * @dev positionValue = baseBalance * markPrice + quoteBalance
     * @param trader Address of the trader
     * @return Position value in USDC terms (can be negative)
     */
    function getPositionValue(address trader) public returns (int256) {
        (int256 baseBalance, int256 quoteBalance, ) = positionTracker.getPosition(trader);
        
        // If no position, return 0
        if (baseBalance == 0 && quoteBalance == 0) {
            return 0;
        }
        
        uint256 markPrice = getMarkPrice();
        
        // Calculate: baseBalance * markPrice + quoteBalance
        // Note: baseBalance is in 1e18, markPrice is in 1e18, result should be in 1e18
        int256 baseValue = (baseBalance * int256(markPrice)) / 1e18;
        int256 positionValue = baseValue + quoteBalance;
        
        return positionValue;
    }
    
    /**
     * @notice Gets the mark price from the Uniswap V3 pool
     * @dev Reads sqrtPriceX96 from pool and converts to price
     * @return Mark price in 1e18 format (USDC per ETH)
     */
    function getMarkPrice() public view returns (uint256) {
        require(address(pool) != address(0), "Pool not set");
        (uint160 sqrtPriceX96, , , , , , ) = pool.slot0();
        require(sqrtPriceX96 > 0, "Invalid pool price");
        
        // Convert sqrtPriceX96 to price
        // price = (sqrtPriceX96 / 2^96)^2
        uint256 priceX192 = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
        require(priceX192 > 0, "Invalid priceX192");
        
        // Check the raw price value (before scaling)
        uint256 priceRaw = priceX192 >> 192;
        
        // If price < 1, it means we have vETH/vUSDC (like 0.0005)
        // We want vUSDC/vETH (like 2000), so calculate inverse
        if (priceRaw < 1) {
            // Price is very small (< 1), need to invert
            // inverse = (2^192 / priceX192) * 1e18
            uint256 inversePriceRaw = (uint256(1) << 192) / priceX192;
            require(inversePriceRaw > 0, "Invalid inverse price");
            return inversePriceRaw * 1e18;
        } else {
            // Price >= 1, use it directly
            return priceRaw * 1e18;
        }
    }
    
    /**
     * @notice Gets a trader's full position details
     * @param trader Address of the trader
     * @return baseBalance Base token balance (vETH)
     * @return quoteBalance Quote token balance (vUSDC)
     * @return realizedPnl Realized profit/loss
     * @return unrealizedPnl Unrealized profit/loss
     * @return collateral Total collateral in vault
     * @return freeCollateral Available collateral
     */
    function getPositionDetails(address trader) external returns (
        int256 baseBalance,
        int256 quoteBalance,
        int256 realizedPnl,
        int256 unrealizedPnl,
        uint256 collateral,
        uint256 freeCollateral
    ) {
        (baseBalance, quoteBalance, realizedPnl) = positionTracker.getPosition(trader);
        unrealizedPnl = getPositionValue(trader);
        collateral = vault.balances(trader);
        freeCollateral = getFreeCollateral(trader);
    }
    
    /**
     * @notice Gets the account value (collateral + unrealized PnL + realized PnL)
     * @param trader Address of the trader
     * @return Account value in USDC
     */
    function getAccountValue(address trader) external returns (int256) {
        uint256 collateral = vault.balances(trader);
        int256 unrealizedPnl = getPositionValue(trader);
        (, , int256 realizedPnl) = positionTracker.getPosition(trader);
        
        return int256(collateral) + unrealizedPnl + realizedPnl;
    }
}
