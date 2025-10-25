# Perpetual Contracts

This directory contains the smart contracts for the minimal perpetual exchange protocol built on top of Uniswap V3, protected by Arcology's NettingEngine for MEV resistance and parallel execution.

---

## 📁 Contract Overview

### Current Status

| Contract | Status | Lines | Tests | Description |
|----------|--------|-------|-------|-------------|
| VirtualToken.sol | ✅ Complete | 82 | 50+ | ERC20 with mint/burn for virtual assets |
| CollateralVault.sol | 📝 Planned | - | - | USDC collateral management |
| PositionTracker.sol | 📝 Planned | - | - | Thread-safe position tracking |
| PerpSwapRequestStore.sol | 📝 Planned | - | - | Perp-specific request storage |
| PerpNettingEngine.sol | 📝 Planned | - | - | Extended netting engine |
| PerpNetting.sol | 📝 Planned | - | - | Perp-specific netting logic |
| PerpClearingHouse.sol | 📝 Planned | - | - | Main user interface |

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────────┐
│                   PerpClearingHouse                        │
│  (Main user interface - deposit, trade, withdraw)         │
└───────────────────┬────────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
        ▼                       ▼
┌──────────────┐      ┌──────────────────────┐
│ Collateral   │      │  PerpNettingEngine   │
│ Vault        │      │  (Deferred batch     │
│ [IMMEDIATE]  │      │   processing)        │
└──────────────┘      └──────────────────────┘
                               │
                    ┌──────────┴────────────┐
                    │                       │
                    ▼                       ▼
            ┌──────────────┐      ┌──────────────┐
            │ PerpNetting  │      │  Position    │
            │ (Core logic) │      │  Tracker     │
            └──────────────┘      │ [Concurrent] │
                                  └──────────────┘
```

---

## 📋 Implementation Order

Follow this order for best results:

### Phase 1: Foundation (Week 1) ✅
1. ✅ **VirtualToken.sol** - Complete with tests
2. **CollateralVault.sol** - Next to implement
3. **PositionTracker.sol** - Requires understanding of Arcology containers

### Phase 2: Request Handling (Week 2)
4. **PerpSwapRequestStore.sol** - Extends SwapRequestStore

### Phase 3: Netting Extensions (Week 3-4)
5. **PerpNettingEngine.sol** - Extends NettingEngine
6. **PerpNetting.sol** - Extends Netting

### Phase 4: User Interface (Week 5)
7. **PerpClearingHouse.sol** - Ties everything together

---

## 🔑 Key Concepts

### Virtual Tokens (vETH, vUSDC)

**Purpose:**
- Not backed by real assets
- Used purely for position tracking
- Minted/burned on demand during trades

**Example:**
```solidity
// User opens 1 vETH long position
// vETH is minted to user
vETH.mint(user, 1 ether);

// Position is tracked
positionTracker.updatePosition(user, +1 vETH, -2000 vUSDC);
```

### Concurrent Containers

**Why Needed:**
- Standard Solidity mappings cause conflicts in parallel execution
- Arcology's `Base` containers are thread-safe
- Essential for deferred execution model

**Pattern:**
```solidity
contract PositionTracker is Base {
    constructor() Base(Const.BYTES, false) {}
    
    function set(address key, Position memory pos) {
        Base._set(abi.encodePacked(key), abi.encode(pos));
    }
    
    function get(address key) returns (Position memory) {
        (, bytes memory data) = Base._get(abi.encodePacked(key));
        return abi.decode(data, (Position));
    }
}
```

### Deferred Execution

**Flow:**
1. **Queue Phase:** User calls `openPosition()` → Request queued
2. **Batch Phase:** End of block → `Runtime.isInDeferred()` == true
3. **Execution:** Batch processing → Netting → Position updates

**Benefits:**
- MEV protection (no transaction ordering)
- Parallel processing (no state conflicts)
- Capital efficiency (internal netting)

---

## 🧪 Testing

### Run Tests

```bash
# Run all perpetual tests
npx hardhat test test/unit/*.test.js

# Run specific test
npx hardhat test test/unit/VirtualToken.test.js

# Run with coverage
npx hardhat coverage
```

### Test Structure

```
test/
├── unit/
│   ├── VirtualToken.test.js ✅
│   ├── CollateralVault.test.js (TBD)
│   └── PositionTracker.test.js (TBD)
├── integration/
│   └── PerpClearingHouse.test.js (TBD)
└── scenarios/
    ├── BasicFlow.test.js (TBD)
    └── NettingEfficiency.test.js (TBD)
```

---

## 📖 Documentation

### For Detailed Information

- **Migration Plan:** See `../PERPETUALS_MIGRATION_PLAN.md`
- **Architecture:** See `../ARCHITECTURE_DIAGRAM.md`
- **Quick Start:** See `../QUICK_START_GUIDE.md`
- **Project Summary:** See `../PROJECT_SUMMARY.md`

### Inline Documentation

All contracts include:
- NatSpec comments for all functions
- @dev notes for implementation details
- @param and @return documentation
- Usage examples where applicable

---

## 🚀 Getting Started

### Prerequisites

```bash
npm install --save-dev @openzeppelin/contracts
npm install --save-dev @arcologynetwork/concurrentlib
```

### Study Existing Patterns

Before implementing new contracts, study:

1. **NettingEngine.sol** - Deferred execution pattern
2. **Netting.sol** - Netting logic
3. **SwapRequestStore.sol** - Concurrent container usage
4. **VirtualToken.sol** - Complete example with tests

### Development Workflow

```bash
# 1. Create contract
touch contracts/Perpetual/NewContract.sol

# 2. Write tests first (TDD)
touch test/unit/NewContract.test.js

# 3. Implement contract
# ... code in your editor ...

# 4. Run tests
npx hardhat test test/unit/NewContract.test.js

# 5. Fix issues, iterate
# ... repeat steps 3-4 ...

# 6. Integration testing
# ... add to integration tests ...
```

---

## ⚠️ Common Pitfalls

### 1. Using Standard Mappings in Deferred Context

❌ **Wrong:**
```solidity
mapping(address => Position) public positions;
```

✅ **Correct:**
```solidity
contract PositionTracker is Base {
    constructor() Base(Const.BYTES, false) {}
}
```

### 2. Immediate State Changes in Queue Functions

❌ **Wrong:**
```solidity
function openPosition(...) {
    positions[user] = newPosition; // DON'T!
}
```

✅ **Correct:**
```solidity
function openPosition(...) {
    perpNettingEngine.queuePositionChange(...); // Queue only
}
```

### 3. Forgetting Margin Checks

❌ **Wrong:**
```solidity
function openPosition(...) {
    perpNettingEngine.queuePositionChange(...);
}
```

✅ **Correct:**
```solidity
function openPosition(...) {
    _requireSufficientCollateral(user, amount);
    perpNettingEngine.queuePositionChange(...);
}
```

---

## 🔍 Debugging Tips

### Enable Debug Logs

```solidity
event DebugLog(string message, uint256 value);
emit DebugLog("isInDeferred", Runtime.isInDeferred() ? 1 : 0);
```

### Check Position State

```solidity
(int256 base, int256 quote, int256 pnl) = 
    positionTracker.getPosition(user);
console.log("Position:", base, quote, pnl);
```

### Verify Netting

```solidity
emit NettingDebug(
    isNettable,
    nettableAmount,
    smallerSideKey,
    largerSideKey
);
```

---

## 📊 Performance Metrics

### Target Metrics

- **Throughput:** 1000+ positions/block
- **Netting Efficiency:** >80% internal matching
- **Gas Savings:** 50%+ vs traditional
- **Parallel Processing:** 20 threads

### Benchmarking

```bash
# Run benchmark script
npx hardhat run scripts/benchmark-netting.js
```

---

## 🔐 Security Considerations

### Audit Checklist

- [ ] All position updates through concurrent containers
- [ ] Margin checks at queue AND execution time
- [ ] Virtual token supply tracking
- [ ] Overflow/underflow protection (use SafeMath for <0.8.0)
- [ ] Access control on all privileged functions
- [ ] Event emission for all state changes

### Known Limitations (MVP)

- ❌ No liquidations (Phase 2)
- ❌ No funding rate (Phase 2)
- ❌ Single market only (vETH/vUSDC)
- ❌ No price oracles (uses pool price)
- ❌ No emergency pause

---

## 🤝 Contributing

### Code Style

- Follow Solidity style guide
- NatSpec for all public functions
- Comprehensive error messages
- Events for state changes
- Gas optimization where possible

### Pull Request Checklist

- [ ] Tests pass
- [ ] New tests added for new functionality
- [ ] NatSpec documentation complete
- [ ] No compiler warnings
- [ ] Gas usage analyzed
- [ ] Integration tests updated

---

## 📞 Support

### Resources

- **Migration Plan:** Full specifications and timeline
- **Architecture Docs:** System design and flows
- **Quick Start:** Day-by-day implementation guide
- **Test Examples:** See VirtualToken.test.js

### Questions?

1. Check inline comments in contracts
2. Review migration plan documentation
3. Study existing NettedAMM contracts
4. Review test files for usage examples

---

## 📝 License

MIT License - See LICENSE file for details

---

## 🎯 Next Steps

### If Starting Fresh

1. Read `PERPETUALS_MIGRATION_PLAN.md`
2. Study `ARCHITECTURE_DIAGRAM.md`
3. Follow `QUICK_START_GUIDE.md`
4. Start with `CollateralVault.sol`

### If Continuing

1. Review existing `VirtualToken.sol`
2. Run existing tests
3. Implement next contract in sequence
4. Follow TDD methodology

---

**Status:** Foundation Complete ✅  
**Next:** CollateralVault.sol  
**Timeline:** 6 weeks to full MVP  

---

*For detailed specifications and implementation guidance, see the documentation files in the parent directory.*
