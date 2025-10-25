// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.6.0;

import "../../UniswapV3Periphery/libraries/PoolAddress.sol";

/**
 * @title PoolLibrary
 * @notice Utility functions for working with Uniswap V3 pool addresses and keys.
 * @dev
 *  - Helps derive unique pool identifiers (keys) and compute deterministic pool addresses.
 *  - Wraps around Uniswap's `PoolAddress` helper for cleaner usage.
 */
library PoolLibrary {

    /**
     * @notice Generates a unique key for a given pool/token combination.
     * @dev
     *  - Combines `poolAddr` and `token` into a single `bytes32` identifier.
     *  - Used for mapping or lookup purposes.
     * @param poolAddr The address of the Uniswap V3 pool.
     * @param token The address of one of the pool's tokens.
     * @return A `bytes32` unique identifier for the pool/token combination.
     */
    function GetKey(address poolAddr, address token) internal pure returns (bytes32) {
        return abi.decode(abi.encodePacked(poolAddr, token), (bytes32));
    }
    
    /**
     * @notice Computes the deterministic Uniswap V3 pool address for a token pair and fee tier.
     * @dev
     *  - Uses Uniswap V3's `PoolAddress.computeAddress` to derive the canonical pool address.
     * @param poolfactory The Uniswap V3 factory address.
     * @param tokenIn The first token of the pool.
     * @param tokenOut The second token of the pool.
     * @param fee The fee tier of the pool (e.g., 500, 3000, 10000).
     * @return The computed address of the corresponding Uniswap V3 pool.
     */
    function computePoolAddr(address poolfactory, address tokenIn, address tokenOut, uint24 fee) internal pure returns (address) {
        return PoolAddress.computeAddress(poolfactory, PoolAddress.getPoolKey(tokenIn, tokenOut, fee));
    }
}
