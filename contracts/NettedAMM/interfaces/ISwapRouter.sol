// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.7.0;
pragma abicoder v2;

/**
 * @title ISwapRouter
 * @notice Minimal interface for interacting with the external swap router
 *         (e.g., Uniswap V3-style router) and handling safe ERC20 transfers.
 */
interface ISwapRouter {
    /**
     * @notice Executes an "exact input" swap against a pool.
     * @dev Similar to Uniswap V3 `exactInputSingle`, but adapted for external
     *      calls within Arcology’s architecture.
     * @param amountIn Amount of `tokenIn` to swap.
     * @param recipient Address to receive the swap output.
     * @param sqrtPriceLimitX96 Optional price limit in Uniswap V3 sqrtPrice format.
     * @param tokenIn Address of the token being swapped from.
     * @param tokenOut Address of the token being swapped to.
     * @param fee Pool fee tier (Uniswap V3 style: e.g., 500, 3000, 10000).
     * @param sender Address paying the input tokens.
     * @return amountOut Actual amount of `tokenOut` received.
     */
    function exactInputExternal(
        uint256 amountIn,
        address recipient,
        uint160 sqrtPriceLimitX96,
        address tokenIn,
        address tokenOut,
        uint24 fee,
        address sender
    ) external payable returns (uint256 amountOut);

    /**
     * @notice Safely transfers ERC20 tokens from one address to another.
     * @dev Must succeed or revert.
     * @param token ERC20 token address.
     * @param from Source address.
     * @param value Amount to transfer.
     */
    function safeTransferFrom(
        address token,
        address from,
        uint256 value
    ) external;

    /**
     * @notice Safely transfers ERC20 tokens to an address.
     * @dev Must succeed or revert.
     * @param token ERC20 token address.
     * @param to Recipient address.
     * @param value Amount to transfer.
     */
    function safeTransfer(
        address token,
        address to,
        uint256 value
    ) external;
}
