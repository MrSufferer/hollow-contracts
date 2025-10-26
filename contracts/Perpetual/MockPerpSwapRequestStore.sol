// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6;
pragma abicoder v2;

/**
 * @title MockPerpSwapRequestStore
 * @notice Mock version of PerpSwapRequestStore for unit testing without Arcology concurrent containers.
 * @dev
 *  - Uses standard Solidity arrays instead of Base concurrent containers.
 *  - Functionally identical to PerpSwapRequestStore for testing purposes.
 *  - Suitable for Hardhat unit tests; use real PerpSwapRequestStore for Arcology network.
 */
contract MockPerpSwapRequestStore {
    /**
     * @dev Represents a perpetual swap request with position metadata.
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

    // Standard storage array for testing
    PerpSwapRequest[] private requests;
    uint256 private nextId;

    /**
     * @notice Stores a new perpetual swap request.
     * @dev Pushes to array and returns the index (mimics uuid() behavior).
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
    ) public returns (uint256) {
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
        
        requests.push(req);
        uint256 id = nextId;
        nextId++;
        return id;
    }

    /**
     * @notice Retrieves a stored perpetual swap request by index.
     */
    function getPerpRequest(uint256 idx) public view returns (PerpSwapRequest memory) {
        require(idx < requests.length, "Index out of bounds");
        return requests[idx];
    }

    /**
     * @notice Updates the `amountIn` for a stored perpetual swap request.
     */
    function updatePerpRequest(uint256 idx, uint256 amountIn) public {
        require(idx < requests.length, "Index out of bounds");
        requests[idx].amountIn = amountIn;
    }

    /**
     * @notice Retrieves detailed fields from a perpetual swap request.
     */
    function getPerpRequestDetailed(uint256 idx)
        public
        view
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
        require(idx < requests.length, "Index out of bounds");
        PerpSwapRequest memory req = requests[idx];
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

    /**
     * @notice Helper function to get total number of requests stored.
     */
    function getRequestCount() public view returns (uint256) {
        return requests.length;
    }

    /**
     * @notice Alias for getRequestCount() for compatibility.
     */
    function count() public view returns (uint256) {
        return requests.length;
    }

    /**
     * @notice Helper function to clear all requests (useful for test cleanup).
     */
    function clear() public {
        delete requests;
        nextId = 0;
    }
}
