// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.7.0;
pragma abicoder v2;

import "../SwapRequestStore.sol";
import "../PoolLookup.sol";
import "@arcologynetwork/concurrentlib/lib/map/HashU256Cum.sol";

/**
 * @title INetting
 * @notice Interface for the core netting contract that coordinates token deposits,
 *         calculates nettable amounts, and executes swaps for a given pool.
 * @dev 
 *  - This is called by the `NettingEngine` during parallel batch processing.
 *  - Abstracts away actual pool swap execution logic from request aggregation logic.
 */
interface INetting {

    /**
     * @notice Determines if a pool has enough opposing swap requests to perform netting.
     * @param poolAddr Address of the Uniswap V3 pool being evaluated.
     * @param pools PoolLookup helper mapping pool addresses to token pairs.
     * @param directionTotals Map storing aggregated swap amounts for all directions.
     * @return isNettable Whether netting/swapping is possible for this pool.
     * @return nettableAmount Minimum amount that can be swapped between both sides.
     * @return keyMin Storage key for the smaller-side token.
     * @return keyMax Storage key for the larger-side token.
     */
    function findNettableAmount(
        address poolAddr,
        PoolLookup pools,
        HashU256Map directionTotals
    )
        external
        returns (
            bool isNettable,
            uint256 nettableAmount,
            bytes32 keyMin,
            bytes32 keyMax
        );

    /**
     * @notice Accepts tokens from a swap request into a common settlement account.
     * @dev Called by the NettingEngine when recording a swap request.
     * @param tokenIn Address of the token being deposited.
     * @param sender Address that initiated the swap.
     * @param amountIn Amount of token to deposit.
     */
    function depositSingle(
        address tokenIn,
        address sender,
        uint256 amountIn
    ) external;

    /**
     * @notice Executes the actual netted swap between the two sides.
     * @param isNettable Whether the swap is valid (from `findNettableAmount`).
     * @param smallerSide  List of swap requests from the smaller-side token.
     * @param largerSide  List of swap requests from the larger-side token.
     * @param poolAddr Pool address where the swap will occur.
     * @param nettableAmount Amount to swap between the two sides.
     */
    function swap(
        bool isNettable,
        SwapRequestStore smallerSide ,
        SwapRequestStore largerSide ,
        address poolAddr,
        uint256 nettableAmount
    ) external;

    /**
     * @notice Returns the current parallel execution process ID.
     * @dev Used for associating swap requests with their originating parallel thread.
     */
    function GetPid() external returns (bytes32 pid);
}
