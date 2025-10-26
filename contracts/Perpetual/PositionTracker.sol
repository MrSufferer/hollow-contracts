// SPDX-License-Identifier: MIT
pragma solidity =0.7.6;
pragma abicoder v2;

import "@arcologynetwork/concurrentlib/lib/core/Primitive.sol";
import "@arcologynetwork/concurrentlib/lib/core/Const.sol";

/**
 * @title PositionTracker
 * @notice Thread-safe position tracking for perpetual futures protocol
 * @dev
 *  - Extends Arcology's `Base` concurrent container for conflict-free parallel execution
 *  - Stores position data: baseBalance (vETH), quoteBalance (vUSDC), realizedPnl
 *  - Used during deferred execution phase by PerpNettingEngine
 *  - Key: abi.encodePacked(traderAddress)
 *  - Value: abi.encode(Position struct)
 */
contract PositionTracker is Base {
    
    /**
     * @dev Represents a trader's perpetual position
     * @param baseBalance Virtual base token balance (vETH). Positive = long, negative = short
     * @param quoteBalance Virtual quote token balance (vUSDC). Opposite sign of baseBalance
     * @param realizedPnl Cumulative realized profit/loss in USDC terms
     */
    struct Position {
        int256 baseBalance;      // vETH: + long, - short
        int256 quoteBalance;     // vUSDC: opposite of base
        int256 realizedPnl;      // Cumulative realized P&L
    }
    
    // ========== EVENTS ==========
    
    event PositionUpdated(
        address indexed trader,
        int256 baseBalance,
        int256 quoteBalance,
        int256 realizedPnl
    );
    
    event PnlRealized(
        address indexed trader,
        int256 pnlAmount,
        int256 totalRealizedPnl
    );
    
    event PositionQuery(
        int256 baseBalance,
        int256 quoteBalance,
        int256 realizedPnl
    );
    
    event PositionValueQuery(
        int256 positionValue
    );
    
    event HasPositionQuery(
        bool hasPosition
    );
    
    /**
     * @notice Initializes the concurrent storage container for positions
     * @dev Uses Const.BYTES mode to store ABI-encoded Position structs
     */
    constructor() Base(Const.BYTES, false) {}
    
    /**
     * @notice Updates a trader's position by adding deltas to base and quote balances
     * @dev Thread-safe operation using Arcology's concurrent container
     * @param trader Address of the trader
     * @param baseChange Change in base token balance (can be positive or negative)
     * @param quoteChange Change in quote token balance (can be positive or negative)
     */
    function updatePosition(
        address trader,
        int256 baseChange,
        int256 quoteChange
    ) external {
        bytes memory key = abi.encodePacked(trader);
        (, bytes memory data) = Base._get(key);
        
        Position memory pos;
        if (data.length > 0) {
            pos = abi.decode(data, (Position));
        }
        // else: pos remains default (0, 0, 0)
        
        pos.baseBalance += baseChange;
        pos.quoteBalance += quoteChange;
        
        Base._set(key, abi.encode(pos));
        
        emit PositionUpdated(trader, pos.baseBalance, pos.quoteBalance, pos.realizedPnl);
    }
    
    /**
     * @notice Records realized PnL for a trader (e.g., when closing a position)
     * @dev Thread-safe operation using Arcology's concurrent container
     * @param trader Address of the trader
     * @param pnl Realized profit/loss amount to add (can be positive or negative)
     */
    function realizePnl(address trader, int256 pnl) external {
        bytes memory key = abi.encodePacked(trader);
        (, bytes memory data) = Base._get(key);
        
        Position memory pos;
        if (data.length > 0) {
            pos = abi.decode(data, (Position));
        }
        
        pos.realizedPnl += pnl;
        
        Base._set(key, abi.encode(pos));
        
        emit PnlRealized(trader, pnl, pos.realizedPnl);
    }
    
    /**
     * @notice Retrieves a trader's current position
     * @dev Returns (0, 0, 0) if trader has no position. Emits PositionQuery event with values.
     * @param trader Address of the trader
     * @return baseBalance Current base token balance
     * @return quoteBalance Current quote token balance
     * @return realizedPnl Cumulative realized profit/loss
     */
    function getPosition(address trader) external returns (
        int256 baseBalance,
        int256 quoteBalance,
        int256 realizedPnl
    ) {
        bytes memory key = abi.encodePacked(trader);
        (, bytes memory data) = Base._get(key);
        
        if (data.length == 0) {
            emit PositionQuery(0, 0, 0);
            return (0, 0, 0);
        }
        
        Position memory pos = abi.decode(data, (Position));
        emit PositionQuery(pos.baseBalance, pos.quoteBalance, pos.realizedPnl);
        return (pos.baseBalance, pos.quoteBalance, pos.realizedPnl);
    }
    
    /**
     * @notice Calculates the current value of a trader's position at a given mark price
     * @dev Formula: positionValue = (baseBalance * markPrice / 1e18) + quoteBalance. Emits PositionValueQuery event.
     * @param trader Address of the trader
     * @param markPrice Current mark price in 18 decimals (e.g., 2000e18 for $2000/ETH)
     * @return Position value in quote token terms (positive = profit, negative = loss)
     */
    function getPositionValue(address trader, uint256 markPrice) external returns (int256) {
        bytes memory key = abi.encodePacked(trader);
        (, bytes memory data) = Base._get(key);
        
        if (data.length == 0) {
            emit PositionValueQuery(0);
            return 0;
        }
        
        Position memory pos = abi.decode(data, (Position));
        
        // Calculate: (baseBalance * markPrice) / 1e18 + quoteBalance
        // Note: We need to be careful with signed/unsigned arithmetic
        int256 baseValueInQuote = (pos.baseBalance * int256(markPrice)) / 1e18;
        int256 positionValue = baseValueInQuote + pos.quoteBalance;
        
        emit PositionValueQuery(positionValue);
        return positionValue;
    }
    
    /**
     * @notice Checks if a trader has an open position
     * @dev Emits HasPositionQuery event with result
     * @param trader Address of the trader
     * @return True if trader has non-zero base or quote balance
     */
    function hasPosition(address trader) external returns (bool) {
        bytes memory key = abi.encodePacked(trader);
        (, bytes memory data) = Base._get(key);
        
        if (data.length == 0) {
            emit HasPositionQuery(false);
            return false;
        }
        
        Position memory pos = abi.decode(data, (Position));
        bool result = pos.baseBalance != 0 || pos.quoteBalance != 0;
        
        emit HasPositionQuery(result);
        return result;
    }
}
