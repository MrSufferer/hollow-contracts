// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6;
pragma abicoder v2;

import "../NettedAMM/SwapRequestStore.sol";

/**
 * @title PerpSwapRequestStore
 * @notice Extends SwapRequestStore with perpetual-specific fields for position tracking.
 * @dev
 *  - Inherits thread-safe concurrent storage from SwapRequestStore (Base).
 *  - Adds `isOpenPosition` and `isLong` flags to distinguish perpetual operations.
 *  - Used by PerpNettingEngine to queue position changes for deferred batch execution.
 */
contract PerpSwapRequestStore is SwapRequestStore {
    /**
     * @dev Represents a perpetual swap request with position metadata.
     * @param txhash Unique transaction identifier for reference.
     * @param tokenIn ERC20 token address being swapped from.
     * @param tokenOut ERC20 token address being swapped to.
     * @param fee Pool fee tier (Uniswap V3 style: e.g., 500, 3000, 10000).
     * @param sender Original swap initiator (position owner).
     * @param recipient Address that should receive the output tokens.
     * @param amountIn Amount of `tokenIn` to be swapped.
     * @param sqrtPriceLimitX96 Price limit for swap execution (Uniswap V3 format).
     * @param amountOut Expected output amount at capture time.
     * @param isOpenPosition True if opening a position, false if closing.
     * @param isLong True for long position, false for short position.
     */
    struct PerpSwapRequest {
        bytes32 txhash;
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address sender;
        address recipient;
        uint256 amountIn;
        uint160 sqrtPriceLimitX96;
        uint256 amountOut;
        bool isOpenPosition;
        bool isLong;
    }

    /**
     * @notice Stores a new perpetual swap request into the concurrent container.
     * @dev
     *  - All parameters from parent SwapRequest plus perp-specific flags.
     *  - Uses `uuid()` to generate a unique storage key for each request.
     *  - Thread-safe for parallel execution during queueing phase.
     * @param txhash Unique transaction hash.
     * @param tokenIn Input token address (e.g., vUSDC for opening long).
     * @param tokenOut Output token address (e.g., vETH for opening long).
     * @param fee Pool fee tier.
     * @param sender Address initiating the position change.
     * @param recipient Address to receive tokens (typically same as sender).
     * @param amountIn Amount of input token.
     * @param sqrtPriceLimitX96 Price limit in Uniswap V3 sqrtPrice format.
     * @param amountOut Expected output amount at capture time.
     * @param isOpenPosition True = opening position, False = closing position.
     * @param isLong True = long (buy vETH), False = short (sell vETH).
     */
    function pushPerpRequest(
        bytes32 txhash,
        address tokenIn,
        address tokenOut,
        uint24 fee,
        address sender,
        address recipient,
        uint256 amountIn,
        uint160 sqrtPriceLimitX96,
        uint256 amountOut,
        bool isOpenPosition,
        bool isLong
    ) public {
        PerpSwapRequest memory req = PerpSwapRequest({
            txhash: txhash,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee: fee,
            sender: sender,
            recipient: recipient,
            amountIn: amountIn,
            sqrtPriceLimitX96: sqrtPriceLimitX96,
            amountOut: amountOut,
            isOpenPosition: isOpenPosition,
            isLong: isLong
        });
        
        Base._set(Base.uuid(), abi.encode(req));
    }

    /**
     * @notice Retrieves a stored perpetual swap request by index.
     * @param idx Entry index in the container.
     * @return req The complete PerpSwapRequest struct.
     */
    function getPerpRequest(uint256 idx) public returns (PerpSwapRequest memory) {
        (, bytes memory data) = Base._get(idx);
        
        // Return empty struct if no data found
        if (data.length == 0) {
            return PerpSwapRequest({
                txhash: bytes32(0),
                tokenIn: address(0),
                tokenOut: address(0),
                fee: 0,
                sender: address(0),
                recipient: address(0),
                amountIn: 0,
                sqrtPriceLimitX96: 0,
                amountOut: 0,
                isOpenPosition: false,
                isLong: false
            });
        }
        
        return abi.decode(data, (PerpSwapRequest));
    }

    /**
     * @notice Updates the `amountIn` for a stored perpetual swap request.
     * @dev Preserves all other fields including perp-specific flags.
     * @param idx Entry index in the container.
     * @param amountIn New input amount to set.
     */
    function updatePerpRequest(uint256 idx, uint256 amountIn) public {
        (, bytes memory data) = Base._get(idx);
        PerpSwapRequest memory req = abi.decode(data, (PerpSwapRequest));
        req.amountIn = amountIn;
        Base._set(idx, abi.encode(req));
    }

    /**
     * @notice Retrieves detailed fields from a perpetual swap request.
     * @param idx Entry index in the container.
     * @return txhash Transaction hash.
     * @return tokenIn Input token address.
     * @return tokenOut Output token address.
     * @return fee Pool fee tier.
     * @return sender Position owner address.
     * @return recipient Token receiver address.
     * @return amountIn Swap input amount.
     * @return sqrtPriceLimitX96 Price limit.
     * @return amountOut Expected swap output amount.
     * @return isOpenPosition True if opening position.
     * @return isLong True if long position.
     */
    function getPerpRequestDetailed(uint256 idx)
        public
        returns (
            bytes32 txhash,
            address tokenIn,
            address tokenOut,
            uint24 fee,
            address sender,
            address recipient,
            uint256 amountIn,
            uint160 sqrtPriceLimitX96,
            uint256 amountOut,
            bool isOpenPosition,
            bool isLong
        )
    {
        PerpSwapRequest memory req = getPerpRequest(idx);
        return (
            req.txhash,
            req.tokenIn,
            req.tokenOut,
            req.fee,
            req.sender,
            req.recipient,
            req.amountIn,
            req.sqrtPriceLimitX96,
            req.amountOut,
            req.isOpenPosition,
            req.isLong
        );
    }
}
