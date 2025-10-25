# Perpetuals Protocol Architecture Diagram

## High-Level System Flow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              USER INTERACTIONS                                │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    │                 │                 │
                    ▼                 ▼                 ▼
          ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
          │   deposit()  │  │ openPosition │  │   withdraw() │
          │              │  │ closePosition│  │              │
          │ [IMMEDIATE]  │  │  [QUEUED]    │  │ [IMMEDIATE]  │
          └──────────────┘  └──────────────┘  └──────────────┘
                    │                 │                 │
                    └─────────────────┼─────────────────┘
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                          PERP CLEARING HOUSE                                  │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                      STATE MANAGEMENT LAYER                            │  │
│  │  • Collateral tracking                                                 │  │
│  │  • Margin requirement validation                                       │  │
│  │  • Position query interface                                            │  │
│  │  • Free collateral calculation                                         │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
                    │                                     │
       [IMMEDIATE]  │                                     │  [QUEUED]
                    ▼                                     ▼
    ┌───────────────────────────┐        ┌──────────────────────────────────┐
    │   COLLATERAL VAULT        │        │   PERP NETTING ENGINE            │
    │   [Direct State Changes]  │        │   [Deferred Batch Processing]    │
    │                           │        │                                  │
    │  • USDC deposits          │        │  Extends NettingEngine           │
    │  • USDC withdrawals       │        │  ┌────────────────────────────┐  │
    │  • Balance tracking       │        │  │  QUEUEING PHASE            │  │
    │  • Safety checks          │        │  │  (Concurrent Execution)    │  │
    └───────────────────────────┘        │  │                            │  │
                                         │  │  1. queuePositionChange()  │  │
                                         │  │  2. Store in               │  │
                                         │  │     PerpSwapRequestStore   │  │
                                         │  │  3. Aggregate totals       │  │
                                         │  │  4. Track active pools     │  │
                                         │  └────────────────────────────┘  │
                                         │              ↓                   │
                                         │  ┌────────────────────────────┐  │
                                         │  │  DEFERRED PHASE            │  │
                                         │  │  (Batch Execution)         │  │
                                         │  │                            │  │
                                         │  │  1. Runtime.isInDeferred() │  │
                                         │  │  2. Multiprocess(20 pools) │  │
                                         │  │  3. netAndExecutePerpSwaps │  │
                                         │  └────────────────────────────┘  │
                                         └──────────────────────────────────┘
                                                        │
                                                        ▼
                        ┌───────────────────────────────────────────────────┐
                        │            PERP NETTING (Core Logic)              │
                        │            Extends Netting                        │
                        │                                                   │
                        │  ┌─────────────────────────────────────────────┐  │
                        │  │  1. findNettableAmountPerp()                │  │
                        │  │     • Match opposing long/short positions   │  │
                        │  │     • Calculate nettable amounts            │  │
                        │  └─────────────────────────────────────────────┘  │
                        │                    ↓                              │
                        │  ┌─────────────────────────────────────────────┐  │
                        │  │  2. executeNettedPerpSwaps()                │  │
                        │  │     • Smaller side: fully satisfied         │  │
                        │  │     • Larger side: partially satisfied      │  │
                        │  │     • Mint virtual tokens                   │  │
                        │  │     • Update positions                      │  │
                        │  └─────────────────────────────────────────────┘  │
                        │                    ↓                              │
                        │  ┌─────────────────────────────────────────────┐  │
                        │  │  3. processLeftoverPerpSwaps()              │  │
                        │  │     • Unmatched orders → Pool               │  │
                        │  │     • Execute via SwapRouter                │  │
                        │  │     • Update positions                      │  │
                        │  └─────────────────────────────────────────────┘  │
                        └───────────────────────────────────────────────────┘
                │                                   │                    │
                │                                   │                    │
                ▼                                   ▼                    ▼
    ┌───────────────────┐            ┌──────────────────────┐  ┌──────────────┐
    │ POSITION TRACKER  │            │  UNISWAP V3 POOL     │  │ VIRTUAL      │
    │ [Concurrent]      │            │  (vETH/vUSDC)        │  │ TOKENS       │
    │                   │            │                      │  │              │
    │ • baseBalance     │            │  Handles leftover    │  │ • vETH       │
    │ • quoteBalance    │            │  unmatched swaps     │  │ • vUSDC      │
    │ • realizedPnL     │            │  only                │  │              │
    │                   │            │                      │  │ Mint/Burn    │
    │ Thread-safe       │            │  Price discovery     │  │ on demand    │
    │ updates during    │            └──────────────────────┘  └──────────────┘
    │ deferred exec     │
    └───────────────────┘
```

---

## Detailed Component Interaction Flow

### Scenario 1: User Opens Long Position

```
┌─────────────┐
│   User A    │
└──────┬──────┘
       │ 1. deposit(1000 USDC)
       ▼
┌──────────────────────┐
│  PerpClearingHouse   │──────► CollateralVault.deposit()
└──────┬───────────────┘        [IMMEDIATE: Balance = 1000 USDC]
       │
       │ 2. openPosition(isLong=true, amount=1 vETH)
       │    Pre-check: 1000 USDC >= (1 vETH * 2000 USDC) * 10% ✓
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│  PerpNettingEngine.queuePositionChange()                        │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ • Get pid (transaction ID)                                │  │
│  │ • Compute pool address (vUSDC/vETH)                       │  │
│  │ • Create key = hash(pool, vUSDC)                          │  │
│  │ • Store in perpSwapRequestBuckets[key]:                   │  │
│  │   - txhash: pid                                           │  │
│  │   - tokenIn: vUSDC                                        │  │
│  │   - tokenOut: vETH                                        │  │
│  │   - sender: User A                                        │  │
│  │   - amountIn: 2000 vUSDC (at 1:2000 price)                │  │
│  │   - amountOut: 1 vETH                                     │  │
│  │   - isOpenPosition: true                                  │  │
│  │   - isLong: true                                          │  │
│  │ • Aggregate: swapTotals[key] += 2000 vUSDC                │  │
│  │ • Track active pool                                       │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
       │
       │ [USER A'S TRANSACTION ENDS HERE - RETURNS IMMEDIATELY]
       │
       │
       │ ... Meanwhile, User B opens short position concurrently ...
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│  DEFERRED EXECUTION PHASE (End of Block)                        │
│  Runtime.isInDeferred() == true                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Multiprocess.run() - Parallel Pool Processing            │  │
│  │                                                           │  │
│  │ For pool vETH/vUSDC:                                      │  │
│  │   netAndExecutePerpSwaps(vETH/vUSDC pool)                 │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│  PerpNetting.swapPerp()                                         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 1. findNettableAmountPerp():                              │  │
│  │    • Long side (vUSDC→vETH): User A wants 1 vETH          │  │
│  │    • Short side (vETH→vUSDC): User B wants to sell 1 vETH │  │
│  │    • MATCH FOUND! Nettable amount = 1 vETH                │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 2. executeNettedPerpSwaps():                              │  │
│  │    ┌──────────────────────────────────────────────────┐   │  │
│  │    │ User A (long):                                   │   │  │
│  │    │  • Mint 1 vETH to User A                         │   │  │
│  │    │  • NO POOL INTERACTION                           │   │  │
│  │    │  • PositionTracker.updatePosition(User A):       │   │  │
│  │    │    - baseBalance += 1 vETH                       │   │  │
│  │    │    - quoteBalance -= 2000 vUSDC                  │   │  │
│  │    │  • Emit WriteBackEvent(User A tx)                │   │  │
│  │    └──────────────────────────────────────────────────┘   │  │
│  │    ┌──────────────────────────────────────────────────┐   │  │
│  │    │ User B (short):                                  │   │  │
│  │    │  • Burn 1 vETH from User B                       │   │  │
│  │    │  • Mint 2000 vUSDC to User B                     │   │  │
│  │    │  • NO POOL INTERACTION                           │   │  │
│  │    │  • PositionTracker.updatePosition(User B):       │   │  │
│  │    │    - baseBalance -= 1 vETH                       │   │  │
│  │    │    - quoteBalance += 2000 vUSDC                  │   │  │
│  │    │  • Emit WriteBackEvent(User B tx)                │   │  │
│  │    └──────────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 3. RESULT:                                                │  │
│  │    • 100% internal netting (no pool interaction!)         │  │
│  │    • Both positions opened at exact same price            │  │
│  │    • Zero slippage                                        │  │
│  │    • Zero MEV opportunity                                 │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

### Scenario 2: Unmatched Position (Pool Interaction Required)

```
┌─────────────┐
│   User C    │
└──────┬──────┘
       │ openPosition(isLong=true, amount=5 vETH)
       │ [Only 2 vETH short orders available for netting]
       ▼
┌─────────────────────────────────────────────────────────────────┐
│  Deferred Execution                                             │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 1. Netting Phase:                                         │  │
│  │    • 2 vETH matched internally with shorts                │  │
│  │    • 3 vETH leftover (no matching shorts)                 │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 2. Process Leftover:                                      │  │
│  │    ┌────────────────────────────────────────────────────┐ │  │
│  │    │ swapWithPool(3 vETH leftover):                     │ │  │
│  │    │  • Call SwapRouter.exactInputExternal()            │ │  │
│  │    │  • Interact with Uniswap V3 pool                   │ │  │
│  │    │  • Execute 3 vETH swap                             │ │  │
│  │    │  • Update User C position with result              │ │  │
│  │    └────────────────────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 3. Final Position:                                        │  │
│  │    User C:                                                │  │
│  │    • baseBalance = +5 vETH                                │  │
│  │    • quoteBalance = -(2 vETH netted + 3 vETH swapped)     │  │
│  │    • 2 vETH: Zero slippage (netted)                       │  │
│  │    • 3 vETH: Pool price + slippage                        │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Structures & Storage Layout

### PositionTracker (Concurrent Container)

```
┌─────────────────────────────────────────────────────────────────┐
│  PositionTracker (extends Base)                                 │
│  Storage: Concurrent Key-Value Store                            │
│                                                                 │
│  Key: abi.encodePacked(traderAddress)                           │
│  Value: abi.encode(Position)                                    │
│                                                                 │
│  struct Position {                                              │
│      int256 baseBalance;      // vETH: + long, - short          │
│      int256 quoteBalance;     // vUSDC: opposite of base        │
│      int256 realizedPnl;      // Cumulative realized P&L        │
│  }                                                              │
│                                                                 │
│  Thread-safe operations:                                        │
│  • updatePosition(trader, baseΔ, quoteΔ)                        │
│  • realizePnl(trader, pnl)                                      │
│  • getPosition(trader) → (base, quote, pnl)                     │
│  • getPositionValue(trader, markPrice) → int256                 │
└─────────────────────────────────────────────────────────────────┘
```

### PerpSwapRequestStore (Concurrent Container)

```
┌─────────────────────────────────────────────────────────────────┐
│  PerpSwapRequestStore (extends SwapRequestStore)                │
│  Storage: Concurrent Array (UUID-indexed)                       │
│                                                                 │
│  struct PerpSwapRequest {                                       │
│      bytes32 txhash;           // Transaction ID                │
│      address tokenIn;          // Input token (vUSDC or vETH)   │
│      address tokenOut;         // Output token (vETH or vUSDC)  │
│      uint24 fee;               // Pool fee tier                 │
│      address sender;           // Position owner                │
│      address recipient;        // Token recipient               │
│      uint256 amountIn;         // Input amount                  │
│      uint160 sqrtPriceLimitX96;// Price limit                   │
│      uint256 amountOut;        // Expected output (pre-calc)    │
│      bool isOpenPosition;      // true=open, false=close        │
│      bool isLong;              // true=long, false=short         │
│  }                                                              │
│                                                                 │
│  Operations:                                                    │
│  • pushPerpRequest(...) → stores request                        │
│  • getPerpRequest(idx) → retrieves request                      │
│  • update(idx, amountIn) → modifies amount                      │
└─────────────────────────────────────────────────────────────────┘
```

### CollateralVault (Standard Storage)

```
┌─────────────────────────────────────────────────────────────────┐
│  CollateralVault                                                │
│  Storage: Standard Solidity mapping                             │
│                                                                 │
│  mapping(address => uint256) public balances;                   │
│                                                                 │
│  Operations (IMMEDIATE execution):                              │
│  • deposit(trader, amount)                                      │
│  • withdraw(trader, amount)                                     │
│  • getBalance(trader) → uint256                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Execution Model Comparison

### Traditional Approach (Without Netting)

```
Block N:
  Tx 1: User A openLong(1 ETH)  ──► Pool.swap() ──► Price changes
  Tx 2: User B openShort(1 ETH) ──► Pool.swap() ──► Price changes
  Tx 3: User C openLong(2 ETH)  ──► Pool.swap() ──► Price changes
  
  Result:
  • 3 pool interactions
  • Cumulative slippage
  • MEV opportunity (sandwich Tx 3)
  • Price impact: High
```

### Netting Engine Approach (Arcology)

```
Block N:
  Tx 1: User A openLong(1 ETH)  ──► Queue ──┐
  Tx 2: User B openShort(1 ETH) ──► Queue ──┤ Concurrent
  Tx 3: User C openLong(2 ETH)  ──► Queue ──┘ (No conflicts)
  
  Deferred Execution:
  ┌────────────────────────────────────────────┐
  │ Netting Phase:                             │
  │ • User A (long 1) ←→ User B (short 1)      │
  │   = Internal match (no pool)               │
  │ • User C (long 2) = Leftover               │
  │                                            │
  │ Pool Interaction:                          │
  │ • Only User C's 2 ETH hits pool            │
  │ • 1 pool interaction (vs 3)                │
  │ • 67% reduction in pool touches            │
  └────────────────────────────────────────────┘
  
  Result:
  • 1 pool interaction (vs 3)
  • Minimal slippage (only leftover)
  • Zero MEV opportunity (all concurrent)
  • Price impact: Low
```

---

## Margin & Risk Management Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  Margin Requirement Calculation                                 │
│                                                                 │
│  Constants:                                                     │
│  • MARGIN_RATIO = 10% (10x leverage)                            │
│  • PRECISION = 1e18                                             │
│                                                                 │
│  Formula:                                                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ positionValue = baseBalance × markPrice + quoteBalance    │   │
│  │ requiredMargin = |positionValue| × MARGIN_RATIO / 100     │   │
│  │ freeCollateral = collateral - requiredMargin              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Example:                                                       │
│  User has:                                                      │
│  • Collateral: 1000 USDC                                        │
│  • Position: +1 vETH (long)                                     │
│  • Mark Price: 2000 USDC/ETH                                    │
│                                                                 │
│  Calculation:                                                   │
│  • baseBalance = 1 vETH                                         │
│  • quoteBalance = -2000 vUSDC (used to buy)                     │
│  • positionValue = (1 × 2000) + (-2000) = 0 (opened at market) │
│  • requiredMargin = |0| × 10% = 0 USDC (no unrealized P&L)     │
│  • freeCollateral = 1000 - 0 = 1000 USDC ✓                      │
│                                                                 │
│  If price moves to 2500 USDC/ETH:                               │
│  • positionValue = (1 × 2500) + (-2000) = 500 USDC profit      │
│  • requiredMargin = |500| × 10% = 50 USDC                       │
│  • freeCollateral = 1000 - 50 = 950 USDC ✓                      │
│                                                                 │
│  Withdrawal Check:                                              │
│  • Can withdraw up to 950 USDC                                  │
│  • Must keep at least 50 USDC for margin                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Contract Inheritance Hierarchy

```
┌─────────────────────────────────────────────────────────────────┐
│                    Base (Arcology Concurrent)                   │
│  • Thread-safe storage operations                               │
│  • Deterministic conflict resolution                            │
│  • UUID generation                                              │
└────────────────────────┬────────────────────────────────────────┘
                         │
         ┌───────────────┴───────────────┐
         │                               │
         ▼                               ▼
┌──────────────────┐          ┌──────────────────────┐
│ PositionTracker  │          │ SwapRequestStore     │
│  (Concurrent)    │          │  (Concurrent)        │
└──────────────────┘          └─────────┬────────────┘
                                        │
                                        ▼
                              ┌──────────────────────┐
                              │PerpSwapRequestStore  │
                              │  (adds perp fields)  │
                              └──────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                       NettingEngine                             │
│  • queueSwapRequest()                                           │
│  • netAndExecuteSwaps()                                         │
│  • Deferred execution registration                              │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │ PerpNettingEngine    │
              │  • queuePositionChange()
              │  • netAndExecutePerpSwaps()
              │  • Position tracking integration
              └──────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                           Netting                               │
│  • findNettableAmount()                                         │
│  • executeNettedSwaps()                                         │
│  • processLeftoverSwaps()                                       │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │     PerpNetting      │
              │  • executeNettedPerpSwaps()
              │  • Position updates in swaps
              │  • PnL calculations
              └──────────────────────┘
```

---

## Key Takeaways

### 🎯 Critical Design Principles

1. **Separation of Concerns**
   - Collateral operations: Immediate execution
   - Position changes: Deferred execution
   - Clear boundary between the two

2. **Thread Safety**
   - All position updates use Arcology concurrent containers
   - No standard Solidity mappings for deferred operations
   - Deterministic conflict resolution

3. **MEV Protection**
   - All position changes queued
   - Batch processing eliminates transaction ordering
   - Netting reduces attack surface

4. **Capital Efficiency**
   - Internal matching minimizes pool interaction
   - Reduced slippage for netted orders
   - Lower gas costs

5. **Extensibility**
   - Easy to add liquidations (Phase 2)
   - Funding rate integration straightforward
   - Multiple markets support ready

---

**For implementation details, see:** `PERPETUALS_MIGRATION_PLAN.md`
