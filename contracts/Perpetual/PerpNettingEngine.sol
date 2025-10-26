// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.7.6;
pragma abicoder v2;

import '../NettedAMM/NettingEngine.sol';
import './PerpSwapRequestStore.sol';
import './PositionTracker.sol';
import '../UniswapV3Periphery/libraries/Path.sol';
import '@arcologynetwork/concurrentlib/lib/runtime/Runtime.sol';
import './interfaces/IPerpNetting.sol';

/**
 * @title PerpNettingEngine
 * @notice Extends NettingEngine to handle perpetual position changes with deferred batch execution.
 * @dev
 *  - Inherits queueing and deferred execution patterns from NettingEngine.
 *  - Uses PerpSwapRequestStore instead of SwapRequestStore to track position metadata.
 *  - Integrates with PositionTracker for updating user positions during deferred execution.
 *  - Adds `queuePositionChange()` for perpetual-specific position operations.
 *  - Overrides storage to use PerpSwapRequestStore buckets.
 *
 * Key Flow:
 *  1. User calls `queuePositionChange()` → stores request in PerpSwapRequestStore
 *  2. Deferred execution triggers → processes all queued requests per pool
 *  3. Netting matches opposing positions (long vs short)
 *  4. PositionTracker updates positions atomically
 *  5. Events emitted for off-chain tracking
 */
contract PerpNettingEngine is NettingEngine {
    using Path for bytes;

    /// @notice Position tracker for managing user positions
    PositionTracker public positionTracker;

    /// @notice Address of the perpetual clearing house (authorized caller)
    address public clearingHouse;

    /// @notice Netting contract for perpetual-specific swap execution
    address public perpNetting;

    /// @dev Perpetual swap requests grouped by (pool, token) key
    mapping(bytes32 => PerpSwapRequestStore) private perpSwapRequestBuckets;

    /// @notice Emitted when perpetual netting engine is initialized
    event PerpInitialized(
        address indexed positionTracker,
        address indexed clearingHouse,
        address indexed perpNetting
    );

    /// @notice Emitted when a position change is queued
    event PositionChangeQueued(
        bytes32 indexed txhash,
        address indexed trader,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        bool isOpenPosition,
        bool isLong
    );

    /**
     * @notice Constructor - registers deferred execution for position changes
     */
    constructor() {
        // Register deferred call for perpetual position changes
        // Must match the function signature exactly
        Runtime.defer("queuePositionChange(address,address,address,uint24,uint256,uint160,uint256,bool,bool)", 300000);
    }

    /**
     * @notice Initializes perpetual-specific components.
     * @dev Must be called after NettingEngine.init().
     * @param _positionTracker Address of the PositionTracker contract.
     * @param _clearingHouse Address of the PerpClearingHouse contract.
     * @param _perpNetting Address of the PerpNetting contract.
     */
    function initPerp(
        address _positionTracker,
        address _clearingHouse,
        address _perpNetting
    ) external {
        require(_positionTracker != address(0), "Invalid positionTracker");
        require(_clearingHouse != address(0), "Invalid clearingHouse");
        require(_perpNetting != address(0), "Invalid perpNetting");
        
        positionTracker = PositionTracker(_positionTracker);
        clearingHouse = _clearingHouse;
        perpNetting = _perpNetting;

        emit PerpInitialized(_positionTracker, _clearingHouse, _perpNetting);
    }

    /**
     * @notice Initializes request store for a pool with perpetual-specific storage.
     * @dev Sets up pool lookup and perpetual request stores.
     * @param pool Pool address.
     * @param tokenA First token in the pair.
     * @param tokenB Second token in the pair.
     */
    function initPerpPool(address pool, address tokenA, address tokenB) external {
        require(pool != address(0), "Invalid pool");
        require(tokenA != address(0), "Invalid tokenA");
        require(tokenB != address(0), "Invalid tokenB");
        
        // Initialize pool lookup and totals tracking (direct access to internal vars)
        pools.set(pool, tokenA, tokenB);
        totalPools++;
        
        // Register perpetual-specific request stores for BOTH tokens
        // This ensures we can handle swaps in both directions
        _registerPerpRequestStore(pool, tokenA);
        _registerPerpRequestStore(pool, tokenB);
    }

    /**
     * @dev Internal: initializes perpetual request tracking for a token in a pool.
     */
    function _registerPerpRequestStore(address pool, address token) internal {
        bytes32 key = PoolLibrary.GetKey(pool, token);
        perpSwapRequestBuckets[key] = new PerpSwapRequestStore();
    }

    /**
     * @notice Queues a perpetual position change request for deferred batch execution.
     * @dev
     *  - Similar to parent's queueSwapRequest() but with perpetual-specific fields.
     *  - Stores request in PerpSwapRequestStore with position metadata.
     *  - Tokens are NOT transferred here (handled by ClearingHouse beforehand).
     *  - Actual position updates happen during deferred execution phase.
     *
     * @param poolAddr Address of the pool (passed directly to avoid computation mismatch).
     * @param tokenIn Input token address (e.g., vUSDC for long, vETH for short).
     * @param tokenOut Output token address (e.g., vETH for long, vUSDC for short).
     * @param fee Pool fee tier (500, 3000, or 10000).
     * @param amountIn Amount of input token.
     * @param sqrtPriceLimitX96 Price limit for swap execution.
     * @param amountOut Expected output amount (pre-calculated).
     * @param isOpenPosition True = opening position, False = closing position.
     * @param isLong True = long (buy vETH), False = short (sell vETH).
     * @return success Always returns true (output determined in deferred phase).
     */
    function queuePositionChange(
        address poolAddr,
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint160 sqrtPriceLimitX96,
        uint256 amountOut,
        bool isOpenPosition,
        bool isLong
    ) external returns (bool success) {
        require(msg.sender == clearingHouse, "Only clearingHouse");

        // Get unique transaction ID (same as parent)
        bytes32 pid = abi.decode(Runtime.pid(), (bytes32));

        // Use pool address directly - no computation needed
        bytes32 keyIn = PoolLibrary.GetKey(poolAddr, tokenIn);

        // Track active pool for this batch (same as parent)
        activePools.set(abi.encodePacked(poolAddr));

        // Store request (use helper to avoid stack too deep)
        _storePerpRequest(keyIn, pid, tokenIn, tokenOut, fee, amountIn, sqrtPriceLimitX96, amountOut, isOpenPosition, isLong);

        // Update aggregated totals for netting (same as parent)
        swapTotals.set(keyIn, amountIn, 0, type(uint256).max);

        emit PositionChangeQueued(pid, tx.origin, tokenIn, tokenOut, amountIn, isOpenPosition, isLong);

        // If inside the deferred execution TX, schedule processing jobs
        if (Runtime.isInDeferred()) {
            uint256 length = activePools.Length();
            for (uint idx = 0; idx < length; idx++) {
                mp.addJob(
                    1000000000,
                    0,
                    address(this),
                    abi.encodeWithSignature(
                        "netAndExecutePerpSwaps(address)",
                        _parseAddr(activePools.get(idx))
                    )
                );
            }
            mp.run();
            activePools.clear();
        }

        return true;
    }

    /**
     * @dev Internal helper to store a perp request (avoids stack too deep).
     */
    function _storePerpRequest(
        bytes32 keyIn,
        bytes32 pid,
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint160 sqrtPriceLimitX96,
        uint256 amountOut,
        bool isOpenPosition,
        bool isLong
    ) internal {
        perpSwapRequestBuckets[keyIn].pushPerpRequest(
            pid,
            tokenIn,
            tokenOut,
            fee,
            tx.origin,
            tx.origin,
            amountIn,
            sqrtPriceLimitX96,
            amountOut,
            isOpenPosition,
            isLong
        );
    }

    /**
     * @notice Processes all perpetual swaps for a given pool with netting.
     * @dev
     *  - Called during deferred execution phase by multiprocess scheduler.
     *  - Finds nettable amounts (matching long vs short positions).
     *  - Delegates to PerpNetting for execution with position updates.
     *  - Clears processed requests after execution.
     *
     * @param poolAddr Address of the pool to process.
     */
    function netAndExecutePerpSwaps(address poolAddr) public {
        // Find nettable amounts using parent's netting logic
        (
            bool canSwap,
            uint256 minCounterPartAmt,
            bytes32 keyMin,
            bytes32 keyMax
        ) = IPerpNetting(perpNetting).findNettableAmountPerp(
            poolAddr,
            pools,
            swapTotals
        );

        // Execute perpetual swaps with position tracking
        IPerpNetting(perpNetting).swapPerp(
            canSwap,
            perpSwapRequestBuckets[keyMin],
            perpSwapRequestBuckets[keyMax],
            poolAddr,
            minCounterPartAmt,
            positionTracker
        );

        // Clear tracking for this pool's keys
        _reset(keyMin);
        _reset(keyMax);
    }

    /**
     * @dev Resets request and total tracking for a specific key.
     * @param key Storage key to reset.
     */
    function _reset(bytes32 key) internal override {
        perpSwapRequestBuckets[key].clear();
        swapTotals._resetByKey(abi.encodePacked(key));
    }

    /**
     * @notice Gets the perpetual request store for a given pool and token.
     * @dev Useful for testing and debugging.
     * @param pool Pool address.
     * @param token Token address.
     * @return store The PerpSwapRequestStore for the given key.
     */
    function getPerpRequestStore(address pool, address token)
        external
        view
        returns (PerpSwapRequestStore)
    {
        bytes32 key = PoolLibrary.GetKey(pool, token);
        return perpSwapRequestBuckets[key];
    }
    
    /**
     * @notice Debug function to check initialization status
     */
    function checkInitialization() external view returns (
        address _factory,
        address _swapCore,
        address _pools,
        address _swapTotals,
        address _activePools,
        address _positionTracker,
        address _clearingHouse,
        address _perpNetting
    ) {
        return (
            factory,
            swapCore,
            address(pools),
            address(swapTotals),
            address(activePools),
            address(positionTracker),
            clearingHouse,
            perpNetting
        );
    }
}