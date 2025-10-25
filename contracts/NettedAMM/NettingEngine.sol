// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.7.6;
pragma abicoder v2;

import '../UniswapV3Periphery/libraries/Path.sol';
import "@arcologynetwork/concurrentlib/lib/runtime/Runtime.sol";
import "@arcologynetwork/concurrentlib/lib/map/HashU256Cum.sol";
import "@arcologynetwork/concurrentlib/lib/multiprocess/Multiprocess.sol";
import "./interfaces/INetting.sol";
import "./libraries/PoolLibrary.sol";
import "./SwapRequestStore.sol";
import "@arcologynetwork/concurrentlib/lib/orderedset/OrderedSet.sol";

/**
 * @title NettingEngine
 * @notice Collects, aggregates, and nets Uniswap V3 swap requests before interacting with liquidity pools.
 *         This enables parallelized swap processing and minimizes pool interactions to reduce gas costs and
 *         mitigate MEV (Miner Extractable Value) risks.
 *
 * @dev By offsetting opposing trades before pool execution, the net trade size is reduced,
 *      eradicating the opportunity for MEV attacks such as sandwiching and
 *      front-running.
 */
contract NettingEngine {
    using Path for bytes;

    /// @dev Uniswap V3 factory address
    address private factory;

    /// @dev Core contract responsible for netting & execution
    address private swapCore;

    /// @notice Emitted after swaps are processed and written back
    event WriteBackEvent(bytes32 indexed pid, bytes32 indexed eventSigner, bytes eventContext);

    /// @dev Pool registry
    PoolLookup private pools;

    /// @dev Multiprocessor with 20 threads for running pool jobs in parallel
    Multiprocess private mp = new Multiprocess(20);

    /// @dev Pending swap requests grouped by (pool, token) key
    mapping (bytes32 => SwapRequestStore) private swapRequestBuckets;

    /// @dev Aggregated input amounts per (pool, token) key
    HashU256Map private swapTotals;

    /// @dev Number of registered pools
    uint256 private totalPools;

    /// @dev Set of active pools in current execution batch
    BytesOrderedSet private activePools = new BytesOrderedSet(false);


    constructor() {
        // Register deferred call for batch swap execution
        Runtime.defer("queueSwapRequest((address,address,uint24,address,uint256,uint256,uint256,uint160))", 300000);
    }

    /**
     * @notice Initializes core addresses and internal storage structures.
     */
    function init(address _factory, address _swapCore) external {
        factory = _factory;
        swapCore = _swapCore;
        pools = new PoolLookup();
        swapTotals = new HashU256Map();
    }

    /**
     * @notice Registers a new pool and initializes tracking structures.
     */
    function initPool(address pool, address tokenA, address tokenB) external {
        pools.set(pool, tokenA, tokenB);
        _registerRequestStore(pool, tokenA);
        _registerRequestStore(pool, tokenB);
        totalPools++;
    }

    /**
     * @dev Internal: initializes request and total tracking for a token in a pool.
     */
    function _registerRequestStore(address pool, address token) internal {
        swapRequestBuckets[PoolLibrary.GetKey(pool, token)] = new SwapRequestStore();
    }

    /// @notice Parameters for `exactInputSingleDefer`
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    /**
     * @notice Queues a single-token swap request for later batch execution.
     * @dev
     *  - Can be called concurrently by multiple transactions in the same block.
     *  - Stores swap request details in a thread-safe concurrent container
     *    (`swapRequestBuckets` and `swapTotals`) without touching the liquidity pool immediately.
     *  - Requests are aggregated by pool and token side for later netting.
     *  - Actual swap execution happens only once per pool during the deferred
     *    processing phase (`Runtime.isInDeferred()`), minimizing:
     *      • Redundant pool interactions
     *      • Price swings (slippage)
     *      • MEV / sandwich attack opportunities
     *  - Tokens are deposited into a common holding account in `swapCore` to
     *    ensure availability for the later netted swap.
     *
     * @param params Uniswap V3-style swap parameters for the request.
     * @return amountOut Always returns 0 here; actual output is determined after batch processing.
     */
    function queueSwapRequest(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut)
    {
        bytes32 pid = abi.decode(Runtime.pid(), (bytes32));

        // Compute pool and key for tracking
        address poolAddr = PoolLibrary.computePoolAddr(factory, params.tokenIn, params.tokenOut, params.fee);
        bytes32 keyIn = PoolLibrary.GetKey(poolAddr, params.tokenIn);

        // Track active pool for this batch
        activePools.set(abi.encodePacked(poolAddr));

        // Store full request details
        swapRequestBuckets[keyIn].push(
            pid,
            abi.encodePacked(params.tokenIn, params.fee, params.tokenOut),
            msg.sender,
            params.recipient,
            params.amountIn,
            params.sqrtPriceLimitX96,
            poolAddr
        );

        // Update aggregated totals for netting
        swapTotals.set(keyIn, params.amountIn, 0, type(uint256).max);

        // Deposit tokens to common account in core
        INetting(swapCore).depositSingle(params.tokenIn, msg.sender, params.amountIn);

        // If inside the deferred execution TX, schedule processing jobs
        if (Runtime.isInDeferred()) {
            uint256 length = activePools.Length();
            for (uint idx = 0; idx < length; idx++) {
                mp.addJob(
                    1000000000,
                    0,
                    address(this),
                    abi.encodeWithSignature("netAndExecuteSwaps(address)", _parseAddr(activePools.get(idx)))
                );
            }
            mp.run();
            activePools.clear();
        }
        amountOut = 0;
    }

    /**
     * @dev Converts encoded bytes into an Ethereum address.
     */
    function _parseAddr(bytes memory rawdata) internal pure returns (address) {
        bytes20 resultAdr;
        for (uint i = 0; i < 20; i++) {
            resultAdr |= bytes20(rawdata[i]) >> (i * 8);
        }
        return address(uint160(resultAdr));
    }

    event Step(uint256 _step);

    /**
     * @notice Processes all swaps for a given pool: tries netting first, then executes leftovers.
     */
    function netAndExecuteSwaps(address poolAddr) public {
        (bool canSwap, uint256 minCounterPartAmt, bytes32 keyMin, bytes32 keyMax) =
            INetting(swapCore).findNettableAmount(poolAddr, pools, swapTotals);

        // Perform netting & execute swaps
        INetting(swapCore).swap(canSwap, swapRequestBuckets[keyMin], swapRequestBuckets[keyMax], poolAddr, minCounterPartAmt);

        // Clear tracking for this pool's keys
        _reset(keyMin);
        _reset(keyMax);
    }

    /**
     * @dev Resets request and total tracking for a specific key.
     */
    function _reset(bytes32 key) internal {
        swapRequestBuckets[key].clear();
        swapTotals._resetByKey(abi.encodePacked(key));
    }
}
