// SPDX-License-Identifier: MIT
pragma solidity =0.7.6;
pragma abicoder v2;

/**
 * @title MockPositionTracker
 * @notice Mock version of PositionTracker using standard Solidity storage for unit testing
 * @dev This contract replicates PositionTracker's API but uses mappings instead of concurrent containers.
 *      Use this for unit tests on standard Hardhat network.
 *      Use PositionTracker.sol for production on Arcology network.
 */
contract MockPositionTracker {
    
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
    
    // Standard Solidity mapping instead of concurrent container
    mapping(address => Position) private positions;
    
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
     * @notice Updates a trader's position by adding deltas to base and quote balances
     * @param trader Address of the trader
     * @param baseChange Change in base token balance (can be positive or negative)
     * @param quoteChange Change in quote token balance (can be positive or negative)
     */
    function updatePosition(
        address trader,
        int256 baseChange,
        int256 quoteChange
    ) external {
        Position storage pos = positions[trader];
        
        pos.baseBalance += baseChange;
        pos.quoteBalance += quoteChange;
        
        emit PositionUpdated(trader, pos.baseBalance, pos.quoteBalance, pos.realizedPnl);
    }
    
    /**
     * @notice Records realized PnL for a trader (e.g., when closing a position)
     * @param trader Address of the trader
     * @param pnl Realized profit/loss amount to add (can be positive or negative)
     */
    function realizePnl(address trader, int256 pnl) external {
        Position storage pos = positions[trader];
        pos.realizedPnl += pnl;
        
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
        Position memory pos = positions[trader];
        
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
        Position memory pos = positions[trader];
        
        // Calculate: (baseBalance * markPrice) / 1e18 + quoteBalance
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
        Position memory pos = positions[trader];
        bool result = pos.baseBalance != 0 || pos.quoteBalance != 0;
        
        emit HasPositionQuery(result);
        return result;
    }
}
