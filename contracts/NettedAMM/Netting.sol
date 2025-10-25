    // SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.6.0;
import "./libraries/PriceLibrary.sol";
import "./libraries/PoolLibrary.sol";
import "./SwapRequestStore.sol";
import "@arcologynetwork/concurrentlib/lib/map/HashU256Cum.sol";
import "../UniswapV3Periphery/libraries/TransferHelper.sol";
import "./interfaces/ISwapRouter.sol";
import "@arcologynetwork/concurrentlib/lib/map/AddressU256Cum.sol";
import "./PoolLookup.sol";


/**
 * @title Netting
 * @notice Handles netting-based token swaps before interacting with Uniswap pools.
 * @dev
 *  - Collects swap requests in parallel during Arcology's concurrent execution.
 *  - Matches opposing swap directions internally (A→B vs. B→A) to minimize on‑chain pool interaction.
 *  - Emits standardized swap execution events for off‑chain indexing and reconciliation.
 */
contract Netting {
    // Event signature hash for UniswapV3-like swap events.
    bytes32 constant eventSigner = keccak256(
        bytes("Swap(address,address,int256,int256,uint160,uint128,int24)")
    );

    // Unified event for writing back swap execution results.
    event WriteBackEvent(
        bytes32 indexed pid,        // Transaction or process ID
        bytes32 indexed eventSigner,// Event type identifier
        bytes eventContext          // Encoded swap result context
    );

    // Marker used as a separator in encoded event payloads.
    bytes32 constant INDEXED_SPLITE =
        0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;

    // Address of the router contract handling actual token transfers and pool interaction.
    address router;

    /**
     * @notice Sets the router used for executing swaps.
     * @param _router Address of the router contract.
     */
    constructor(address _router) {
        router = _router;
    }

    /**
     * @notice Retrieves netting details for a given pool.
     * @dev
     *  - Fetches token pair for the pool.
     *  - Builds keys for both trade directions (A→B, B→A).
     *  - Calculates if the pool has offsetting trades that can be netted.
     *  - Returns the smaller side's key and the larger side's key for execution.
     *
     * @param poolAddr The address of the liquidity pool.
     * @param pools Pool lookup utility to resolve token pairs.
     * @param directionTotals Aggregated swap amounts for each trade direction.
     *
     * @return isNettable Whether there are offsetting trades to net.
     * @return minCounterpartAmount The matched amount from the smaller trade side.
     * @return smallerSideKey  The key for the smaller trade side.
     * @return largerSideKey The key for the larger trade side.
     */
    function findNettableAmount(
        address poolAddr,
        PoolLookup pools,
        HashU256Map directionTotals
    ) 
        external
        returns (
            bool isNettable,
            uint256 minCounterpartAmount,
            bytes32 smallerSideKey ,
            bytes32 largerSideKey
        )
    {
        // Retrieve token pair for this pool
        (address tokenA, address tokenB) = pools.get(poolAddr);

        // Build unique keys for both trade directions
        bytes32 aToBKey = PoolLibrary.GetKey(poolAddr, tokenA);
        bytes32 bToAKey = PoolLibrary.GetKey(poolAddr, tokenB);

        // Determine if trades in opposite directions can offset each other
        bool aIsLess = false;
        (isNettable, minCounterpartAmount, aIsLess) = calculateNettableAmounts(
            poolAddr,
            tokenA,
            tokenB,
            aToBKey,
            bToAKey,
            directionTotals
        );

        // Assign the min/max keys based on which direction has the smaller net amount
        if (aIsLess) {
            (smallerSideKey , largerSideKey) = (aToBKey, bToAKey);
        } else {
            (smallerSideKey , largerSideKey) = (bToAKey, aToBKey);
        }
    }


    /**
     * @notice Determines if a pool has opposing swaps that can be netted and calculates the limit.
     * @dev
     * - Compares total pending amounts for A→B and B→A.
     * - Converts amounts using pool pricing (`PriceLibrary.getAmountOut`) to ensure fair comparison.
     * - Identifies the smaller effective side (limiting factor for netting).
     * @param poolAddr Address of the liquidity pool.
     * @param tokenA First token of the pair.
     * @param tokenB Second token of the pair.
     * @param aToBKey Storage key for aggregated A→B swaps.
     * @param bToAKey Storage key for aggregated B→A swaps.
     * @param directionTotals Map storing aggregated swap amounts for all directions.
     * @return isNettable True if both sides have >0 and can be netted.
     * @return nettableAmount Matched amount in the counterpart token.
     * @return aIsLess True if A→B is the smaller limiting side.
     */

    function calculateNettableAmounts(
        address poolAddr,
        address tokenA,
        address tokenB,
        bytes32 aToBKey,
        bytes32 bToAKey,
        HashU256Map directionTotals
    )
        internal
        returns (
            bool isNettable,
            uint256 nettableAmount,
            bool aIsLess
        )
    {
        // Get aggregated swap amounts for both directions
        uint256 totalAToB = directionTotals.get(aToBKey); // total A→B volume
        uint256 totalBToA = directionTotals.get(bToAKey); // total B→A volume

        // Default: no swap possible
        isNettable = false;
        aIsLess = false;

        // Both sides must have volume for netting to be possible
        if (totalAToB > 0 && totalBToA > 0) {
            // Convert A→B amount into tokenB terms using pool pricing
            uint256 totalAToBB = PriceLibrary.getAmountOut(poolAddr, tokenA, tokenB, totalAToB);

            // Netting is possible
            isNettable = true;

            // Assume B→A is the smaller side (limiting factor)
            uint256 amountMin = totalBToA;
            (address tokenMin, address tokenMax) = (tokenB, tokenA);

            // If converted A→B amount is smaller, then A→B is the limiting side
            if (totalAToBB < amountMin) {
                amountMin = totalAToB;
                (tokenMin, tokenMax) = (tokenA, tokenB);
                nettableAmount = totalAToBB;
                aIsLess = true;
            } else {
                // Convert limiting B→A amount into A terms
                nettableAmount = PriceLibrary.getAmountOut(
                    poolAddr,
                    tokenMin,
                    tokenMax,
                    amountMin
                );
            }
        }
    }
    
    /**
     * @notice Deposits a single token into the router for later netting/swapping.
     * @dev 
     *  - Transfers `amountIn` of `tokenIn` from `sender` into the router contract.
     *  - This does **not** perform a swap; it only stages tokens for the netting process.
     *  - Caller must ensure `sender` has approved the router to spend `amountIn`.
     *
     * @param tokenIn  Address of the ERC20 token being deposited.
     * @param sender   Address providing the tokens.
     * @param amountIn Amount of tokens to deposit into the router.
     */
    function depositSingle(address tokenIn, address sender, uint256 amountIn) external {
        // Securely pull tokens from `sender` into the router
        ISwapRouter(router).safeTransferFrom(tokenIn, sender, amountIn);
    }

    /**
     * @notice Executes swaps depending on whether netting is possible.
     * @param isNettable True if matched orders exist for netting.
     * @param smallerSideRequests Swap requests from the smaller side of the matched pair.
     * @param largerSideRequests Swap requests from the larger side of the matched pair.
     * @param poolAddr Liquidity pool address.
     * @param nettableAmount Amount to be netted between both sides.
     */
    function swap(
        bool isNettable,
        SwapRequestStore smallerSideRequests,
        SwapRequestStore largerSideRequests,
        address poolAddr,
        uint256 nettableAmount
    ) external {
        if (isNettable) {
            // Execute netted swap (internal matching before touching the pool)
            executeNettedSwaps(
                smallerSideRequests,
                largerSideRequests,
                poolAddr,
                nettableAmount,
                PriceLibrary.getSqrtPricex96(poolAddr)
            );
        } else {
            // Fall back to direct pool swaps
            processLeftoverSwaps(
                smallerSideRequests,
                largerSideRequests,
                PriceLibrary.getSqrtPricex96(poolAddr)
            );
        }
    }

    /**
     * @notice Executes matched (netted) swaps between two sides, with leftover routed to AMM.
     * @dev
     *  - Smaller side is fully satisfied by netting → tokens transferred directly.
     *  - Larger side is partially satisfied by netting → leftover goes to AMM.
     * @param smallerSide Swap requests on the smaller side of the netting pair.
     * @param largerSide Swap requests on the larger side of the netting pair.
     * @param poolAddr Address of the liquidity pool.
     * @param nettableAmount Total amount from smaller side matched with larger side.
     * @param sqrtPriceX96 Current sqrt price for event logging and AMM execution.
     */
    function executeNettedSwaps(
        SwapRequestStore smallerSide,
        SwapRequestStore largerSide,
        address poolAddr,
        uint256 nettableAmount,
        uint160 sqrtPriceX96
    ) internal {
        uint256 size = smallerSide.fullLength();

        // Process smaller side: fully satisfied by netting
        for (uint256 i = 0; i < size; i++) {
            if (!smallerSide.exists(i)) continue;

            (, , address tokenOut, , , address recipient, uint256 amountIn, , uint256 amountOut) =
                smallerSide.get(i);

            ISwapRouter(router).safeTransfer(tokenOut, recipient, amountOut);
            EmitSwapEvent(smallerSide, i, amountIn, amountOut, sqrtPriceX96);
        }

        size = largerSide.fullLength();
        bool stillNetting = true;

        // Process larger side: partially satisfied by netting, remainder to AMM
        for (uint256 i = 0; i < size; i++) {
            if (!largerSide.exists(i)) continue;

            (, address tokenIn, address tokenOut, , , address recipient, uint256 amountIn, , uint256 amountOut) =
                largerSide.get(i);

            if (stillNetting) {
                if (nettableAmount >= amountIn) {
                    // Fully satisfied by remaining matched amount
                    nettableAmount -= amountIn;
                    ISwapRouter(router).safeTransfer(tokenOut, recipient, amountOut);
                    EmitSwapEvent(largerSide, i, amountIn, amountOut, sqrtPriceX96);

                    if (nettableAmount == 0) stillNetting = false;
                } else {
                    // Partially satisfied, leftover to AMM
                    uint256 partialOut = PriceLibrary.getAmountOut(poolAddr, tokenIn, tokenOut, nettableAmount);

                    ISwapRouter(router).safeTransfer(tokenOut, recipient, partialOut);
                    EmitSwapEvent(largerSide, i, nettableAmount, partialOut, sqrtPriceX96);

                    // Update request with remaining unsatisfied input
                    largerSide.update(i, amountIn - nettableAmount);

                    stillNetting = false;
                    swapWithPool(largerSide, i, sqrtPriceX96);
                }
            } else {
                // Already exhausted matched amount → go directly to AMM
                swapWithPool(largerSide, i, sqrtPriceX96);
            }
        }
    }

    /**
     * @notice Trade against the liquidity pools directly for the leftovers after netting.
     * @dev 
     *  - Iterates through both sides of the order book (smallerSide and largerSide).
     *  - For each leftover swap request, executes it directly against the underlying pool.
     *  - Called only after the internal netting process to settle unmatched orders.
     *
     * @param smallerSide  Container holding leftover swaps from the smaller‑volume side.
     * @param largerSide   Container holding leftover swaps from the larger‑volume side.
     * @param sqrtPriceX96 Current sqrt price of the pool, used for settlement.
     */
    function processLeftoverSwaps(
        SwapRequestStore smallerSide,
        SwapRequestStore largerSide,
        uint160 sqrtPriceX96
    ) internal {
        // Process leftover swap requests that could not be matched during netting.
        // Each side (smallerSide and largerSide) represents one swap direction.
        // For each remaining request in both sides, execute a direct swap against the liquidity pool.
        if (address(smallerSide) != address(0)) {
            uint256 dataSize = smallerSide.fullLength();
            if (dataSize > 0) {
                for (uint i = 0; i < dataSize; i++) {
                    if (!smallerSide.exists(i)) continue;
                    swapWithPool(smallerSide, i, sqrtPriceX96);
                }
            }
        }

        if (address(largerSide) != address(0)) {
            uint256 dataSize = largerSide.fullLength();
            if (dataSize > 0) {
                for (uint i = 0; i < dataSize; i++) {
                    if (!largerSide.exists(i)) continue;
                    swapWithPool(largerSide, i, sqrtPriceX96);
                }
            }
        }
    }


    /**
     * @notice Executes a single swap request directly against the liquidity pool (no netting).
     * @dev
     *  - Fetches the swap request data from the concurrent container.
     *  - Executes the swap via `ISwapRouter.exactInputExternal`.
     *  - Emits a swap event for tracking.
     *
     * @param list            Container storing batched swap requests.
     * @param idx             Index of the swap request in the container.
     * @param sqrtPriceX96    Current square root price of the pool (used in the emitted event).
     */
    function swapWithPool(
        SwapRequestStore list,
        uint256 idx,
        uint160 sqrtPriceX96
    ) internal {
        (
            , // txhash (unused)
            address tokenIn,
            address tokenOut,
            uint24 fee,
            address sender,
            address recipient,
            uint256 amountIn,
            uint160 sqrtPriceLimitX96,
            
        ) = list.get(idx);

        // Optional: Refund tokens from a common account before swapping
        // ISwapRouter(router).safeTransfer(tokenIn, sender, amountIn);

        // Execute the actual swap against the liquidity pool
        uint256 amountOut = ISwapRouter(router).exactInputExternal(
            amountIn,
            recipient,
            sqrtPriceLimitX96,
            tokenIn,
            tokenOut,
            fee,
            router
        );

        // Emit event for tracking swap execution
        EmitSwapEvent(list, idx, amountIn, amountOut, sqrtPriceX96);
    }


    /**
     * @dev Emits a standardized swap result event for an executed swap request.
     * @param list SwapRequestStore containing the swap request data.
     * @param idx Index of the swap request in the store.
     * @param amount0 Actual input amount processed.
     * @param amount1 Actual output amount received.
     * @param sqrtPriceX96 Current sqrt price of the pool at execution time.
     *
     * The event payload encodes:
     *  - sender and recipient addresses
     *  - `INDEXED_SPLITE` marker (internal event format separator)
     *  - amounts in/out
     *  - sqrt price
     *  - two reserved zero fields (future use)
     */
    function EmitSwapEvent(
        SwapRequestStore list,
        uint idx,
        uint256 amount0,
        uint256 amount1,
        uint160 sqrtPriceX96
    ) internal {
        (
            bytes32 txhash,
            , , , // skip tokenIn, tokenOut, fee
            address sender,
            address recipient,
            , ,   // skip amountIn, sqrtPriceLimitX96
        ) = list.get(idx);

        emit WriteBackEvent(
            txhash,
            eventSigner,
            abi.encode(sender, recipient, INDEXED_SPLITE, amount0, amount1, sqrtPriceX96, 0, 0)
        );
    }
}