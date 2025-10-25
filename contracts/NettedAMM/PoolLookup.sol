// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.7.6;
pragma abicoder v2;

import "@arcologynetwork/concurrentlib/lib/core/Primitive.sol";
import "@arcologynetwork/concurrentlib/lib/core/Const.sol";

/**
 * @title PoolLookup
 * @notice Stores and retrieves token pair information for liquidity pools.
 * @dev Each entry maps a pool key to its underlying token addresses.
 */
contract PoolLookup  is Base {

    /**
     * @notice Defines the token pair for a liquidity pool.
     * @dev
     *  - `tokenA` and `tokenB` are the two ERC-20 token addresses that form the pool.
     *  - Order of tokens matters for key generation and lookup.
     *  - To quickly identify the assets in a pool.
     */
    struct TokenPair {
        address tokenA;
        address tokenB;
    }

    /**
     * @notice Initializes the pool lookup container.
     * @dev Uses Arcology's concurrent container for thread‑safe, deterministic writes.
     *      `Const.BYTES` specifies raw byte storage for conflict‑free parallel inserts.
     */
    constructor() Base(Const.BYTES,false) {}

    /**
     * @notice Check if a pool exists in the registry.
     * @param k Pool identifier.
     * @return exists True if registered, false otherwise.
     */
    function exist(address k) public returns (bool exists) {
        return Base.exists(abi.encodePacked(k));
    }

    /**
     * @notice Store or update a pool’s token pair information.
     * @param k Pool identifier.
     * @param tokenA Address of the first token.
     * @param tokenB Address of the second token.
     */
    function set(address k, address tokenA, address tokenB) public {
        if (tokenA > tokenB) (tokenA, tokenB) = (tokenB, tokenA);
        bytes memory data = abi.encode(TokenPair({tokenA: tokenA, tokenB: tokenB}));
        Base._set(abi.encodePacked(k), data);
    }

    /**
     * @notice Get the token pair associated with a pool ID.
     * @param k Pool identifier.
     * @return tokenA Address of the first token.
     * @return tokenB Address of the second token.
     */
    function get(address k) public returns (address tokenA, address tokenB) {
        (, bytes memory data) = Base._get(abi.encodePacked(k));
        TokenPair memory pd = abi.decode(data, (TokenPair));
        tokenA = pd.tokenA;
        tokenB = pd.tokenB;
    }

    /**
     * @notice Returns the pool key stored at a given index.
     * @param idx The index position.
     * @return key The pool key address.
     */
    function keyAt(uint256 idx) public returns (address key) {
        bytes memory rawdata = Base.indToKey(idx);
        bytes20 resultAdr;
        for (uint i = 0; i < 20; i++) {
            resultAdr |= bytes20(rawdata[i]) >> (i * 8);
        }
        return address(uint160(resultAdr));
    }

    function valueAt(uint256 idx) public virtual returns(address tokenA, address tokenB) { 
        (,bytes memory data)=Base._get(idx);
        TokenPair memory pd = abi.decode(data, (TokenPair));  
        tokenA = pd.tokenA;
        tokenB = pd.tokenB; 
    }    

    /**
     * @notice Delete a key-value pair from the map.
     * @param poolAddr The address key to delete.
     */
    function del(address poolAddr) public { 
        Base._del((abi.encodePacked(poolAddr)));  
    }
}
