## 🧪 Quick Test Commands

```bash
# Unit Tests (Local, Fast with Mocks)
npx hardhat test test/unit/VirtualToken.test.js
npx hardhat test test/unit/CollateralVault.test.js
npx hardhat test test/unit/PositionTracker.test.js
npx hardhat test test/unit/PerpSwapRequestStore.test.js

# Integration Tests (Arcology TestnetInfo - Real contracts)
npx hardhat run test/integration/test-position-tracker.js --network TestnetInfo
npx hardhat run test/integration/test-perp-swap-request-store.js --network TestnetInfo
npx hardhat run test/integration/test-perp-system.js --network TestnetInfo
npx hardhat run test/integration/test-full-liquidity.js --network TestnetInfo
```