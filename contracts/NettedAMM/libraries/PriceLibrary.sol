// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.6.0;

import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol';

/**
 * @title PriceLibrary
 * @notice Utility functions for computing prices and token amounts in Uniswap V3 pools.
 * @dev
 *  - Uses Uniswap's Q96 fixed-point math convention (2^96 scaling factor).
 *  - Provides conversion functions between sqrtPriceX96, price, and token amounts.
 *  - Designed for lightweight, read‑only price calculations within swaps and netting logic.
 */
library PriceLibrary {
    // Q96 = 2^96, used by Uniswap V3 for fixed-point sqrt price representation.
    uint256 internal constant Q96 = 0x1000000000000000000000000;

    /**
     * @notice Converts sqrtPriceX96 to a standard price ratio.
     * @param sqrtPriceX96 The square‑root price in Q96 format.
     * @return priceX96 Price ratio in Q96 fixed‑point format.
     */
    function computePrice(uint256 sqrtPriceX96) internal pure returns (uint256) {
        return (sqrtPriceX96 * sqrtPriceX96) / Q96;
    }

    /**
     * @notice Calculates token A amount given price and token B amount.
     * @param priceX96 Price ratio in Q96 format.
     * @param tokenBAmount Amount of token B.
     * @return Amount of token A equivalent at given price.
     */
    function getTokenAAmount(uint256 priceX96, uint256 tokenBAmount) internal pure returns (uint256) {
        return (tokenBAmount * Q96) / priceX96;
    }

    /**
     * @notice Calculates token B amount given price and token A amount.
     * @param priceX96 Price ratio in Q96 format.
     * @param tokenAAmount Amount of token A.
     * @return Amount of token B equivalent at given price.
     */
    function getTokenBAmount(uint256 priceX96, uint256 tokenAAmount) internal pure returns (uint256) {
        return (tokenAAmount * priceX96) / Q96;
    }

    /**
     * @notice Reads the current sqrtPriceX96 from a Uniswap V3 pool.
     * @param poolAddr Address of the Uniswap V3 pool.
     * @return sqrtPriceX96 The current square‑root price in Q96 format.
     */
    function getSqrtPricex96(address poolAddr) internal view returns (uint160) {
        (uint160 sqrtPriceX96,,,,,,) = IUniswapV3Pool(poolAddr).slot0();
        return sqrtPriceX96;
    }

    /**
     * @notice Computes the amount of output token for a given input amount at current pool price.
     * @param poolAddr Address of the Uniswap V3 pool.
     * @param tokenIn Address of the input token.
     * @param tokenOut Address of the output token.
     * @param _amountIn Amount of input token.
     * @return Amount of output token that would be received.
     */
    function getAmountOut(address poolAddr, address tokenIn, address tokenOut, uint256 _amountIn) internal view returns (uint256) {
        uint256 pricex96 = PriceLibrary.computePrice(getSqrtPricex96(poolAddr));
        return tokenIn < tokenOut
            ? PriceLibrary.getTokenBAmount(pricex96, _amountIn)
            : PriceLibrary.getTokenAAmount(pricex96, _amountIn);
    }
}

