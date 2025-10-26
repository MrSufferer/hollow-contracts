// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6;
pragma abicoder v2;

import '../PerpSwapRequestStore.sol';
import '../PositionTracker.sol';
import '../../NettedAMM/PoolLookup.sol';
import '@arcologynetwork/concurrentlib/lib/map/HashU256Cum.sol';

/**
 * @title IPerpNetting
 * @notice Interface for perpetual netting operations.
 * @dev Extends standard netting with position tracking capabilities.
 */
interface IPerpNetting {
    /**
     * @notice Finds nettable amounts for perpetual positions in a pool.
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
        returns (
            bool isNettable,
            uint256 minCounterpartAmount,
            bytes32 smallerSideKey,
            bytes32 largerSideKey
        );

    /**
     * @notice Executes perpetual swaps with position tracking.
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
    ) external;
}
