// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6;
pragma abicoder v2;

import "@arcologynetwork/concurrentlib/lib/core/Primitive.sol";
import "@arcologynetwork/concurrentlib/lib/core/Const.sol";
import '../UniswapV3Periphery/libraries/Path.sol';
import "./libraries/PriceLibrary.sol";

/**
 * @title SwapRequestStore
 * @notice Thread-safe, parallel-execution-compatible container for storing pending swap requests.
 * @dev
 *  - Inherits from Arcology's `Base` concurrent container to allow deterministic,
 *    conflict-free writes during parallel execution.
 *  - Stores full swap request metadata needed to execute later in batch/netting.
 *  - Works with Uniswap V3-compatible pool data.
 */
contract SwapRequestStore is Base {
    using Path for bytes;

    /**
     * @dev Represents a single swap request captured during transaction processing.
     * @param txhash Unique transaction identifier for reference.
     * @param tokenIn ERC20 token address being swapped from.
     * @param tokenOut ERC20 token address being swapped to.
     * @param fee Pool fee tier (Uniswap V3 style: e.g., 500, 3000, 10000).
     * @param sender Original swap initiator.
     * @param recipient Address that should receive the output tokens.
     * @param amountIn Amount of `tokenIn` to be swapped.
     * @param sqrtPriceLimitX96 Price limit for swap execution (Uniswap V3 format).
     * @param amountOut Expected output amount at capture time.
     */
    struct SwapRequest {
        bytes32 txhash;
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address sender;
        address recipient;
        uint256 amountIn;
        uint160 sqrtPriceLimitX96;
        uint256 amountOut;
    }

    /**
     * @notice Initializes the concurrent storage container for swap requests.
     * @dev Uses the Base concurrent library with BYTES mode so entries can be stored as
     *      ABI-encoded `SwapRequest` structs and retrieved by index in a thread-safe way.
     */
    constructor() Base(Const.BYTES,false) {}

    /**
     * @notice Stores a new swap request into the concurrent container.
     * @dev
     *  - Decodes `tokenIn`, `tokenOut`, and `fee` from the given pool path.
     *  - Calculates `amountOut` using `PriceLibary` at capture time.
     *  - Uses `uuid()` to generate a unique storage key for each request.
     * @param txhash Unique transaction hash.
     * @param poolData Encoded Uniswap V3 pool path data.
     * @param sender Address initiating the swap.
     * @param recipient Address to receive swap output.
     * @param amountIn Amount of `tokenIn` to swap.
     * @param sqrtPriceLimitX96 Price limit in Uniswap V3 sqrtPrice format.
     * @param pooladr Liquidity pool contract address.
     */
    function push(
        bytes32 txhash,
        bytes memory poolData,
        address sender,
        address recipient,
        uint256 amountIn,
        uint160 sqrtPriceLimitX96,
        address pooladr
    ) public {
        (address tokenIn, address tokenOut, uint24 fee) = poolData.decodeFirstPool();

        SwapRequest memory callback = SwapRequest({
            txhash: txhash,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee: fee,
            sender: sender,
            recipient: recipient,
            amountIn: amountIn,
            sqrtPriceLimitX96: sqrtPriceLimitX96,
            amountOut: PriceLibrary.getAmountOut(pooladr, tokenIn, tokenOut, amountIn)
        });

        Base._set(uuid(), abi.encode(callback));
    }

    /**
     * @notice Updates the `amountIn` for a stored swap request.
     * @param idx Entry index in the container.
     * @param amountIn New input amount to set.
     */
    function update(uint256 idx, uint256 amountIn) public {
        (, bytes memory data) = Base._get(idx);
        SwapRequest memory callback = abi.decode(data, (SwapRequest));
        callback.amountIn = amountIn;
        Base._set(idx, abi.encode(callback));
    }

    /**
     * @notice Retrieves a stored swap request by index.
     * @param idx Entry index in the container.
     * @return txhash Transaction hash.
     * @return tokenIn Input token address.
     * @return tokenOut Output token address.
     * @return fee Pool fee tier.
     * @return sender Swap initiator address.
     * @return recipient Output token receiver address.
     * @return amountIn Swap input amount.
     * @return sqrtPriceLimitX96 Price limit.
     * @return amountOut Expected swap output amount.
     */
    function get(uint256 idx)
        public
        virtual
        returns (
            bytes32,
            address,
            address,
            uint24,
            address,
            address,
            uint256,
            uint160,
            uint256
        )
    {
        (, bytes memory data) = Base._get(idx);
        SwapRequest memory callback = abi.decode(data, (SwapRequest));
        return (
            callback.txhash,
            callback.tokenIn,
            callback.tokenOut,
            callback.fee,
            callback.sender,
            callback.recipient,
            callback.amountIn,
            callback.sqrtPriceLimitX96,
            callback.amountOut
        );
    }
}
