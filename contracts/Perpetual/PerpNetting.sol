// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.7.6;
pragma abicoder v2;

import '../NettedAMM/Netting.sol';
import './PerpSwapRequestStore.sol';
import './PositionTracker.sol';
import './VirtualToken.sol';
import '../NettedAMM/libraries/PriceLibrary.sol';
import '../NettedAMM/libraries/PoolLibrary.sol';
import './interfaces/IPerpNetting.sol';

/**
 * @title PerpNetting
 * @notice Handles netting-based perpetual position changes before interacting with Uniswap pools.
 * @dev
 *  - Extends base Netting contract with perpetual-specific logic.
 *  - Matches opposing positions (long vs short) internally to minimize AMM interaction.
 *  - Updates user positions in PositionTracker atomically during execution.
 *  - Mints/burns virtual tokens for position changes.
 *  - Calculates PnL for position closes.
 *  - Emits events for off-chain tracking and reconciliation.
 *
 * Key Differences from Base Netting:
 *  - Uses PerpSwapRequestStore instead of SwapRequestStore (adds position metadata).
 *  - Integrates with PositionTracker for position management.
 *  - Handles virtual token minting/burning instead of real token transfers.
 *  - Tracks PnL for position closes.
 */
contract PerpNetting is Netting, IPerpNetting {
    /// @notice Emitted when a perpetual swap is executed with position update
    event PerpSwapExecuted(
        bytes32 indexed txhash,
        address indexed trader,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        bool isOpenPosition,
        bool isLong,
        int256 pnl
    );

    /// @dev Struct to avoid stack too deep in executeNettedPerpSwaps
    struct ExecutionContext {
        address poolAddr;
        uint160 sqrtPriceX96;
        PositionTracker positionTracker;
    }

    /**
     * @notice Sets the router used for executing swaps.
     * @param _router Address of the router contract.
     */
    constructor(address _router) Netting(_router) {}

    /**
     * @notice Finds nettable amounts for perpetual positions in a pool.
     * @dev
     *  - Similar to base findNettableAmount() but works with perpetual positions.
     *  - Matches long vs short positions.
     *  - Returns keys for both sides to process.
     *
     * @param poolAddr The address of the liquidity pool.
     * @param pools Pool lookup utility to resolve token pairs.
     * @param directionTotals Aggregated swap amounts for each trade direction.
     * @return isNettable Whether there are offsetting trades to net.
     * @return minCounterpartAmount The matched amount from the smaller trade side.
     * @return smallerSideKey The key for the smaller trade side.
     * @return largerSideKey The key for the larger trade side.
     */
    function findNettableAmountPerp(
        address poolAddr,
        PoolLookup pools,
        HashU256Map directionTotals
    )
        external
        override
        returns (
            bool isNettable,
            uint256 minCounterpartAmount,
            bytes32 smallerSideKey,
            bytes32 largerSideKey
        )
    {
        // Reuse base netting logic via external call
        return this.findNettableAmount(poolAddr, pools, directionTotals);
    }

    /**
     * @notice Executes perpetual swaps with position tracking.
     * @dev
     *  - Matches opposing positions (long vs short).
     *  - Updates positions in PositionTracker.
     *  - Mints/burns virtual tokens.
     *  - Calculates PnL for closes.
     *  - Routes unmatched orders to AMM.
     *
     * @param canSwap Whether netting is possible.
     * @param smallerSide Request store for the smaller trade side.
     * @param largerSide Request store for the larger trade side.
     * @param poolAddr Address of the pool.
     * @param minCounterPartAmt Matched amount for netting.
     * @param positionTracker Position tracker contract.
     */
    function swapPerp(
        bool canSwap,
        PerpSwapRequestStore smallerSide,
        PerpSwapRequestStore largerSide,
        address poolAddr,
        uint256 minCounterPartAmt,
        PositionTracker positionTracker
    ) external override {
        if (canSwap) {
            // Execute netted swap with position tracking
            executeNettedPerpSwaps(
                smallerSide,
                largerSide,
                poolAddr,
                minCounterPartAmt,
                PriceLibrary.getSqrtPricex96(poolAddr),
                positionTracker
            );
        } else {
            // Fall back to direct pool swaps with position tracking
            processLeftoverPerpSwaps(
                smallerSide,
                largerSide,
                PriceLibrary.getSqrtPricex96(poolAddr),
                positionTracker,
                poolAddr
            );
        }
    }

    /**
     * @notice Executes matched (netted) perpetual swaps with position updates.
     * @dev
     *  - Smaller side is fully satisfied by netting.
     *  - Larger side is partially satisfied by netting, leftover goes to AMM.
     *  - Updates positions in PositionTracker for all trades.
     *  - Mints/burns virtual tokens as needed.
     *  - Calculates PnL for position closes.
     *
     * @param smallerSide Swap requests on the smaller side of the netting pair.
     * @param largerSide Swap requests on the larger side of the netting pair.
     * @param poolAddr Address of the liquidity pool.
     * @param nettableAmount Total amount from smaller side matched with larger side.
     * @param sqrtPriceX96 Current sqrt price for event logging and AMM execution.
     * @param positionTracker Position tracker contract for updating positions.
     */
    function executeNettedPerpSwaps(
        PerpSwapRequestStore smallerSide,
        PerpSwapRequestStore largerSide,
        address poolAddr,
        uint256 nettableAmount,
        uint160 sqrtPriceX96,
        PositionTracker positionTracker
    ) internal {
        ExecutionContext memory ctx = ExecutionContext({
            poolAddr: poolAddr,
            sqrtPriceX96: sqrtPriceX96,
            positionTracker: positionTracker
        });

        uint256 size = smallerSide.fullLength();

        // Process smaller side: fully satisfied by netting
        for (uint256 i = 0; i < size; i++) {
            if (!smallerSide.exists(i)) continue;

            PerpSwapRequestStore.PerpSwapRequest memory request = smallerSide.getPerpRequest(i);

            // Update position and handle virtual tokens
            _executePositionChange(
                ctx.positionTracker,
                request.recipient,
                request.tokenIn,
                request.tokenOut,
                request.amountIn,
                request.amountOut,
                request.isOpenPosition,
                request.isLong
            );

            // Emit perpetual swap event (simplified - no PnL calc for now)
            emit PerpSwapExecuted(
                request.txhash,
                request.recipient,
                request.tokenIn,
                request.tokenOut,
                request.amountIn,
                request.amountOut,
                request.isOpenPosition,
                request.isLong,
                0 // PnL placeholder
            );
        }

        size = largerSide.fullLength();
        bool stillNetting = true;

        // Process larger side: partially satisfied by netting, remainder to AMM
        for (uint256 i = 0; i < size; i++) {
            if (!largerSide.exists(i)) continue;

            PerpSwapRequestStore.PerpSwapRequest memory request = largerSide.getPerpRequest(i);

            if (stillNetting) {
                if (nettableAmount >= request.amountIn) {
                    // Fully satisfied by remaining matched amount
                    nettableAmount -= request.amountIn;

                    _executePositionChange(
                        ctx.positionTracker,
                        request.recipient,
                        request.tokenIn,
                        request.tokenOut,
                        request.amountIn,
                        request.amountOut,
                        request.isOpenPosition,
                        request.isLong
                    );

                    emit PerpSwapExecuted(
                        request.txhash,
                        request.recipient,
                        request.tokenIn,
                        request.tokenOut,
                        request.amountIn,
                        request.amountOut,
                        request.isOpenPosition,
                        request.isLong,
                        0 // PnL placeholder
                    );

                    if (nettableAmount == 0) stillNetting = false;
                } else {
                    // Partially satisfied, leftover to AMM
                    uint256 partialOut = PriceLibrary.getAmountOut(ctx.poolAddr, request.tokenIn, request.tokenOut, nettableAmount);

                    _executePositionChange(
                        ctx.positionTracker,
                        request.recipient,
                        request.tokenIn,
                        request.tokenOut,
                        nettableAmount,
                        partialOut,
                        request.isOpenPosition,
                        request.isLong
                    );

                    emit PerpSwapExecuted(
                        request.txhash,
                        request.recipient,
                        request.tokenIn,
                        request.tokenOut,
                        nettableAmount,
                        partialOut,
                        request.isOpenPosition,
                        request.isLong,
                        0 // PnL placeholder
                    );

                    // Update request with remaining unsatisfied input
                    largerSide.update(i, request.amountIn - nettableAmount);

                    stillNetting = false;
                    swapPerpWithPool(largerSide, i, ctx);
                }
            } else {
                // Already exhausted matched amount → go directly to AMM
                swapPerpWithPool(largerSide, i, ctx);
            }
        }
    }

    /**
     * @notice Processes leftover perpetual swaps that couldn't be netted.
     * @dev
     *  - Executes each remaining request against the AMM.
     *  - Updates positions in PositionTracker.
     *  - Handles virtual token minting/burning.
     *
     * @param smallerSide Container holding leftover swaps from the smaller side.
     * @param largerSide Container holding leftover swaps from the larger side.
     * @param sqrtPriceX96 Current sqrt price of the pool.
     * @param positionTracker Position tracker contract.
     * @param poolAddr Address of the liquidity pool.
     */
    function processLeftoverPerpSwaps(
        PerpSwapRequestStore smallerSide,
        PerpSwapRequestStore largerSide,
        uint160 sqrtPriceX96,
        PositionTracker positionTracker,
        address poolAddr
    ) internal {
        ExecutionContext memory ctx = ExecutionContext({
            poolAddr: poolAddr,
            sqrtPriceX96: sqrtPriceX96,
            positionTracker: positionTracker
        });

        if (address(smallerSide) != address(0)) {
            uint256 dataSize = smallerSide.fullLength();
            if (dataSize > 0) {
                for (uint i = 0; i < dataSize; i++) {
                    if (!smallerSide.exists(i)) continue;
                    swapPerpWithPool(smallerSide, i, ctx);
                }
            }
        }

        if (address(largerSide) != address(0)) {
            uint256 dataSize = largerSide.fullLength();
            if (dataSize > 0) {
                for (uint i = 0; i < dataSize; i++) {
                    if (!largerSide.exists(i)) continue;
                    swapPerpWithPool(largerSide, i, ctx);
                }
            }
        }
    }

    /**
     * @notice Executes a single perpetual swap request against the AMM pool.
     * @dev
     *  - Fetches swap request data.
     *  - Executes swap via router.
     *  - Updates position in PositionTracker.
     *  - Handles virtual token minting/burning.
     *  - Emits swap event with position metadata.
     *
     * @param list Container storing batched swap requests.
     * @param idx Index of the swap request.
     * @param ctx Execution context with poolAddr, sqrtPriceX96, and positionTracker.
     */
    function swapPerpWithPool(
        PerpSwapRequestStore list,
        uint256 idx,
        ExecutionContext memory ctx
    ) internal {
        PerpSwapRequestStore.PerpSwapRequest memory request = list.getPerpRequest(idx);

        // Execute the actual swap against the liquidity pool
        uint256 amountOut = ISwapRouter(router).exactInputExternal(
            request.amountIn,
            request.recipient,
            request.sqrtPriceLimitX96,
            request.tokenIn,
            request.tokenOut,
            request.fee,
            router
        );

        // Update position and handle virtual tokens
        _executePositionChange(
            ctx.positionTracker,
            request.recipient,
            request.tokenIn,
            request.tokenOut,
            request.amountIn,
            amountOut,
            request.isOpenPosition,
            request.isLong
        );

        // Emit perpetual swap event (simplified - no PnL calc for now)
        emit PerpSwapExecuted(
            request.txhash,
            request.recipient,
            request.tokenIn,
            request.tokenOut,
            request.amountIn,
            amountOut,
            request.isOpenPosition,
            request.isLong,
            0 // PnL placeholder
        );
    }

    /**
     * @notice Executes a position change (open or close).
     * @dev
     *  - Opens: Mints virtual tokens, updates position tracker with base/quote changes.
     *  - Closes: Burns virtual tokens, updates position tracker with base/quote changes.
     *  - For long: base = vETH, quote = vUSDC
     *  - For short: base = vETH, quote = vUSDC (opposite signs)
     *
     * @param positionTracker Position tracker contract.
     * @param trader Address of the trader.
     * @param tokenIn Input token address.
     * @param tokenOut Output token address.
     * @param amountIn Input amount.
     * @param amountOut Output amount.
     * @param isOpenPosition True = opening, False = closing.
     * @param isLong True = long, False = short.
     */
    function _executePositionChange(
        PositionTracker positionTracker,
        address trader,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        bool isOpenPosition,
        bool isLong
    ) internal {
        if (isOpenPosition) {
            // Opening position: mint virtual tokens
            VirtualToken(tokenOut).mint(trader, amountOut);
            
            // Update position in tracker using base/quote balance system
            // For long: base (ETH) increases, quote (USDC) decreases
            // For short: base (ETH) decreases, quote (USDC) increases
            if (isLong) {
                // Long: +vETH, -vUSDC
                positionTracker.updatePosition(
                    trader,
                    int256(amountOut),     // base increases (bought vETH)
                    -int256(amountIn)      // quote decreases (paid vUSDC)
                );
            } else {
                // Short: -vETH, +vUSDC
                positionTracker.updatePosition(
                    trader,
                    -int256(amountOut),    // base decreases (sold vETH)
                    int256(amountIn)       // quote increases (received vUSDC)
                );
            }
        } else {
            // Closing position: burn virtual tokens
            VirtualToken(tokenIn).burn(trader, amountIn);
            
            // Update position in tracker (reverse of opening)
            if (isLong) {
                // Closing long: -vETH, +vUSDC
                positionTracker.updatePosition(
                    trader,
                    -int256(amountIn),     // base decreases (sold vETH)
                    int256(amountOut)      // quote increases (received vUSDC)
                );
            } else {
                // Closing short: +vETH, -vUSDC
                positionTracker.updatePosition(
                    trader,
                    int256(amountIn),      // base increases (bought back vETH)
                    -int256(amountOut)     // quote decreases (paid vUSDC)
                );
            }
        }
    }

    /**
     * @notice Calculates PnL for closing a position.
     * @dev
     *  - Simplified calculation based on closing amounts.
     *  - Real PnL tracking happens in PositionTracker via baseBalance/quoteBalance.
     *  - This function provides estimated PnL for event logging.
     *
     * @param positionTracker Position tracker contract.
     * @param trader Address of the trader.
     * @param poolAddr Address of the pool (unused in current implementation).
     * @param amountIn Amount being closed.
     * @param amountOut Output amount from swap.
     * @param isLong True = long, False = short.
     * @return pnl Estimated profit or loss (positive = profit, negative = loss).
     */
    function _calculatePnL(
        PositionTracker positionTracker,
        address trader,
        address poolAddr,
        uint256 amountIn,
        uint256 amountOut,
        bool isLong
    ) internal view returns (int256 pnl) {
        // Simplified PnL calculation for event logging
        // For long: PnL = amountOut (USDC received) - amountIn (ETH sold in USDC terms)
        // For short: PnL = amountOut (ETH bought in USDC terms) - amountIn (USDC paid)
        
        // This is a simplified estimate. Real PnL tracking happens via
        // PositionTracker's baseBalance and quoteBalance.
        
        // For now, return 0 as placeholder
        // TODO: Enhance with proper PnL calculation from position tracker
        return 0;
    }
}
