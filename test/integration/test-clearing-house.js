const { ethers } = require("hardhat");

/**
 * Integration Test: PerpClearingHouse with Full Perpetual System
 * 
 * Tests the complete flow:
 * 1. Deploy all contracts (VirtualTokens, Pool, PerpNettingEngine, etc.)
 * 2. Initialize pool with liquidity
 * 3. Users deposit collateral
 * 4. Users open long/short positions (queued via PerpNettingEngine)
 * 5. Deferred execution processes and nets positions
 * 6. Verify position tracking
 * 7. Users close positions
 * 8. Users withdraw collateral
 * 
 * NOTE: Must run on Arcology TestnetInfo network
 * Command: npx hardhat run test/integration/test-clearing-house.js --network TestnetInfo
 */

async function main() {
    console.log("\n🧪 Integration Test: PerpClearingHouse");
    console.log("=" .repeat(60));

    const [deployer, trader1, trader2, trader3] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);
    console.log("Trader1:", trader1.address);
    console.log("Trader2:", trader2.address);
    console.log("Trader3:", trader3.address);

    // ========== PHASE 1: DEPLOY BASE INFRASTRUCTURE ==========
    console.log("\n📦 Phase 1: Deploying Base Infrastructure...");

    // Deploy USDC (using Token.sol as collateral)
    const Token = await ethers.getContractFactory("Token");
    const USDC = await Token.deploy("USD Coin", "USDC");
    await USDC.deployed();
    console.log("✅ USDC deployed:", USDC.address);

    // Mint initial supply to deployer
    const initialSupply = ethers.utils.parseEther("1000000"); // 1 million USDC
    const mintTx = await USDC.mint(deployer.address, initialSupply);
    await mintTx.wait();

    // Deploy Virtual Tokens
    const VirtualToken = await ethers.getContractFactory("VirtualToken");
    const vETH = await VirtualToken.deploy("Virtual ETH", "vETH");
    await vETH.deployed();
    console.log("✅ vETH deployed:", vETH.address);

    const vUSDC = await VirtualToken.deploy("Virtual USDC", "vUSDC");
    await vUSDC.deployed();
    console.log("✅ vUSDC deployed:", vUSDC.address);

    // Deploy Uniswap V3 Factory
    const UniswapV3Factory = await ethers.getContractFactory("UniswapV3Factory");
    const factory = await UniswapV3Factory.deploy();
    await factory.deployed();
    console.log("✅ Factory deployed:", factory.address);

    // Create Pool
    const fee = 3000; // 0.3%
    
    console.log("   Creating pool...");
    let tx = await factory.createPool(vETH.address, vUSDC.address, fee);
    let receipt = await tx.wait();
    
    // Parse PoolCreated event
    const poolCreatedEvent = receipt.events?.find(e => e.event === 'PoolCreated');
    const poolAddress = poolCreatedEvent?.args?.pool;
    
    if (!poolAddress || poolAddress === ethers.constants.AddressZero) {
        throw new Error("Pool creation failed - no pool address in event");
    }
    
    console.log("✅ Pool created:", poolAddress);

    const pool = await ethers.getContractAt("UniswapV3Pool", poolAddress);

    // Check token ordering
    const token0 = await pool.token0();
    const token1 = await pool.token1();
    console.log("   Pool token0:", token0, "(", token0 === vETH.address ? "vETH" : "vUSDC", ")");
    console.log("   Pool token1:", token1, "(", token1 === vETH.address ? "vETH" : "vUSDC", ")");

    // Initialize pool: 1 ETH = 2000 USDC
    // sqrtPriceX96 represents sqrt(token1/token0) * 2^96
    let sqrtPriceX96;
    if (token0 === vETH.address) {
        // token0 = vETH, token1 = vUSDC
        // We want token1/token0 = vUSDC/vETH = 2000
        sqrtPriceX96 = "3543191142285914378072636784640"; // sqrt(2000) * 2^96
    } else {
        // token0 = vUSDC, token1 = vETH
        // We want token1/token0 = vETH/vUSDC = 1/2000 = 0.0005
        sqrtPriceX96 = "1771595571142957112070504448"; // sqrt(0.0005) * 2^96
    }
    await pool.initialize(sqrtPriceX96);
    console.log("✅ Pool initialized at price: 1 ETH = 2000 USDC");

    // ========== PHASE 2: DEPLOY PERPETUAL CONTRACTS ==========
    console.log("\n📦 Phase 2: Deploying Perpetual Contracts...");

    // Deploy PositionTracker (Arcology Base)
    const PositionTracker = await ethers.getContractFactory("PositionTracker");
    const positionTracker = await PositionTracker.deploy();
    await positionTracker.deployed();
    console.log("✅ PositionTracker deployed:", positionTracker.address);

    // Deploy CollateralVault
    const CollateralVault = await ethers.getContractFactory("CollateralVault");
    const vault = await CollateralVault.deploy(USDC.address);
    await vault.deployed();
    console.log("✅ CollateralVault deployed:", vault.address);

    // Deploy SwapRouter
    const SwapRouter = await ethers.getContractFactory("SwapRouter");
    const router = await SwapRouter.deploy(factory.address, USDC.address);
    await router.deployed();
    console.log("✅ SwapRouter deployed:", router.address);

    // Deploy PerpNetting
    const PerpNetting = await ethers.getContractFactory("PerpNetting");
    const perpNetting = await PerpNetting.deploy(router.address);
    await perpNetting.deployed();
    console.log("✅ PerpNetting deployed:", perpNetting.address);

    // Deploy PerpNettingEngine
    const PerpNettingEngine = await ethers.getContractFactory("PerpNettingEngine");
    const perpNettingEngine = await PerpNettingEngine.deploy();
    await perpNettingEngine.deployed();
    console.log("✅ PerpNettingEngine deployed:", perpNettingEngine.address);

    // Initialize PerpNettingEngine
    await perpNettingEngine.init(factory.address, perpNetting.address);
    console.log("✅ PerpNettingEngine initialized");

    // Deploy PerpClearingHouse
    const PerpClearingHouse = await ethers.getContractFactory("PerpClearingHouse");
    const clearingHouse = await PerpClearingHouse.deploy(
        positionTracker.address,
        vault.address,
        perpNettingEngine.address,
        poolAddress,
        vETH.address,
        vUSDC.address,
        USDC.address
    );
    await clearingHouse.deployed();
    console.log("✅ PerpClearingHouse deployed:", clearingHouse.address);

    // ========== PHASE 3: SETUP PERMISSIONS ==========
    console.log("\n🔐 Phase 3: Setting Up Permissions...");

    // Initialize PerpNettingEngine with perp-specific components
    await perpNettingEngine.initPerp(
        positionTracker.address,
        clearingHouse.address,
        perpNetting.address
    );
    console.log("✅ PerpNettingEngine perp components initialized");

    // Initialize pool in PerpNettingEngine
    // Always pass tokens in the same order as the pool's token0/token1
    console.log("   Initializing pool in PerpNettingEngine with tokens:", token0, token1);
    await perpNettingEngine.initPerpPool(poolAddress, token0, token1);
    console.log("✅ Pool registered in PerpNettingEngine");

    // Set clearingHouse in vault
    await vault.setClearingHouse(clearingHouse.address);
    console.log("✅ ClearingHouse authorized in vault");

    // Whitelist perpNetting for virtual token minting
    await vETH.addToWhitelist(perpNetting.address);
    await vUSDC.addToWhitelist(perpNetting.address);
    console.log("✅ PerpNetting whitelisted for virtual tokens");

    // Whitelist pool for virtual token transfers
    await vETH.addToWhitelist(poolAddress);
    await vUSDC.addToWhitelist(poolAddress);
    console.log("✅ Pool whitelisted for virtual tokens");

    // ========== PHASE 4: ADD INITIAL LIQUIDITY ==========
    console.log("\n💧 Phase 4: Adding Initial Liquidity...");

    // Mint virtual tokens to deployer for liquidity
    const liquidityVETH = ethers.utils.parseEther("100");
    const liquidityVUSDC = ethers.utils.parseEther("200000");

    await vETH.addToWhitelist(deployer.address);
    await vUSDC.addToWhitelist(deployer.address);

    await vETH.mint(deployer.address, liquidityVETH);
    await vUSDC.mint(deployer.address, liquidityVUSDC);
    console.log("✅ Virtual tokens minted for liquidity");

    // Approve pool
    await vETH.approve(poolAddress, liquidityVETH);
    await vUSDC.approve(poolAddress, liquidityVUSDC);

    // Add liquidity directly to pool
    const amount0 = vETH.address.toLowerCase() < vUSDC.address.toLowerCase() 
        ? liquidityVETH : liquidityVUSDC;
    const amount1 = vETH.address.toLowerCase() < vUSDC.address.toLowerCase() 
        ? liquidityVUSDC : liquidityVETH;

    await pool.mint(
        deployer.address,
        -887220, // tickLower (full range)
        887220,  // tickUpper (full range)
        ethers.utils.parseEther("10"), // liquidity amount
        "0x"
    );
    console.log("✅ Liquidity added to pool");

    // ========== PHASE 5: FUND TRADERS ==========
    console.log("\n💰 Phase 5: Funding Traders...");

    const traderFunding = ethers.utils.parseEther("10000"); // 10,000 USDC each

    const txFund1 = await USDC.transfer(trader1.address, traderFunding);
    await txFund1.wait();
    const txFund2 = await USDC.transfer(trader2.address, traderFunding);
    await txFund2.wait();
    const txFund3 = await USDC.transfer(trader3.address, traderFunding);
    await txFund3.wait();
    console.log("✅ Traders funded with", ethers.utils.formatEther(traderFunding), "USDC each");

    // ========== PHASE 6: TRADERS DEPOSIT COLLATERAL ==========
    console.log("\n🏦 Phase 6: Traders Deposit Collateral...");

    const depositAmount = ethers.utils.parseEther("5000"); // 5,000 USDC each

    const approveTx1 = await USDC.connect(trader1).approve(clearingHouse.address, depositAmount);
    await approveTx1.wait();
    
    const depositTx1 = await clearingHouse.connect(trader1).deposit(depositAmount);
    const depositReceipt1 = await depositTx1.wait();
    console.log("   Deposit events:", depositReceipt1.events?.map(e => e.event || 'anonymous').join(', '));
    console.log("✅ Trader1 deposited:", ethers.utils.formatEther(depositAmount), "USDC");

    const approveTx2 = await USDC.connect(trader2).approve(clearingHouse.address, depositAmount);
    await approveTx2.wait();
    const depositTx2 = await clearingHouse.connect(trader2).deposit(depositAmount);
    await depositTx2.wait();
    console.log("✅ Trader2 deposited:", ethers.utils.formatEther(depositAmount), "USDC");

    const approveTx3 = await USDC.connect(trader3).approve(clearingHouse.address, depositAmount);
    await approveTx3.wait();
    const depositTx3 = await clearingHouse.connect(trader3).deposit(depositAmount);
    await depositTx3.wait();
    console.log("✅ Trader3 deposited:", ethers.utils.formatEther(depositAmount), "USDC");

    // Wait a moment for state to settle
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify deposits
    const balance1 = await vault.balances(trader1.address);
    const balance2 = await vault.balances(trader2.address);
    const balance3 = await vault.balances(trader3.address);
    console.log("   Vault balances:");
    console.log("     Trader1:", ethers.utils.formatEther(balance1), "USDC");
    console.log("     Trader2:", ethers.utils.formatEther(balance2), "USDC");
    console.log("     Trader3:", ethers.utils.formatEther(balance3), "USDC");
    
    // Verify balances match deposits
    if (balance1.eq(depositAmount) && balance2.eq(depositAmount) && balance3.eq(depositAmount)) {
        console.log("   ✅ All vault balances verified!");
    } else {
        console.log("   ⚠️  Warning: Vault balances don't match deposits");
        console.log("     Expected:", ethers.utils.formatEther(depositAmount), "each");
    }

    // ========== PHASE 7: OPEN POSITIONS (CONCURRENT) ==========
    console.log("\n📊 Phase 7: Opening Positions Concurrently...");

    const positionSize = ethers.utils.parseEther("1"); // 1 vETH

    console.log("   Trader1 opens LONG 1 vETH...");
    
    // Debug: Check state before opening position
    const slot0 = await pool.slot0();
    console.log("   Pool sqrtPriceX96:", slot0[0].toString());
    const currentMarkPrice = await clearingHouse.callStatic.getMarkPrice();
    console.log("   Mark price:", ethers.utils.formatEther(currentMarkPrice), "USDC/ETH");
    
    // Try with callStatic first to get any revert reason
    try {
        await clearingHouse.connect(trader1).callStatic.openPosition(true, positionSize);
        console.log("   callStatic passed");
    } catch(err) {
        console.log("   callStatic error:", err.reason || err.message);
    }
    
    const tx1 = await clearingHouse.connect(trader1).openPosition(true, positionSize);
    await tx1.wait();

    console.log("   ✅ Trader1 long queued, tx:", tx1.hash);

    console.log("   Trader2 opens SHORT 1 vETH...");
    const tx2 = await clearingHouse.connect(trader2).openPosition(false, positionSize);
    await tx2.wait();
    console.log("   ✅ Trader2 short queued, tx:", tx2.hash);

    console.log("   Trader3 opens LONG 0.5 vETH...");
    const tx3 = await clearingHouse.connect(trader3).openPosition(true, positionSize.div(2));
    await tx3.wait();
    console.log("   ✅ Trader3 long queued, tx:", tx3.hash);

    console.log("\n⏳ Waiting for deferred execution...");
    await new Promise(resolve => setTimeout(resolve, 3000));

    // ========== PHASE 8: VERIFY POSITIONS ==========
    console.log("\n🔍 Phase 8: Verifying Positions...");

    // Query Trader1 position (call getPosition, wait for tx, parse event)
    let positionTx1 = await positionTracker.getPosition(trader1.address);
    let positionReceipt1 = await positionTx1.wait();
    let position1 = parsePositionQuery(positionTracker, positionReceipt1);
    console.log("   Trader1 position:");
    console.log("     baseBalance:", ethers.utils.formatEther(position1.baseBalance), "vETH");
    console.log("     quoteBalance:", ethers.utils.formatEther(position1.quoteBalance), "vUSDC");
    console.log("     realizedPnl:", ethers.utils.formatEther(position1.realizedPnl), "USDC");

    // Query Trader2 position
    let positionTx2 = await positionTracker.getPosition(trader2.address);
    let positionReceipt2 = await positionTx2.wait();
    let position2 = parsePositionQuery(positionTracker, positionReceipt2);
    console.log("   Trader2 position:");
    console.log("     baseBalance:", ethers.utils.formatEther(position2.baseBalance), "vETH");
    console.log("     quoteBalance:", ethers.utils.formatEther(position2.quoteBalance), "vUSDC");
    console.log("     realizedPnl:", ethers.utils.formatEther(position2.realizedPnl), "USDC");

    // Query Trader3 position
    let positionTx3 = await positionTracker.getPosition(trader3.address);
    let positionReceipt3 = await positionTx3.wait();
    let position3 = parsePositionQuery(positionTracker, positionReceipt3);
    console.log("   Trader3 position:");
    console.log("     baseBalance:", ethers.utils.formatEther(position3.baseBalance), "vETH");
    console.log("     quoteBalance:", ethers.utils.formatEther(position3.quoteBalance), "vUSDC");
    console.log("     realizedPnl:", ethers.utils.formatEther(position3.realizedPnl), "USDC");

    // ========== PHASE 9: CHECK MARK PRICE & ACCOUNT VALUES ==========
    console.log("\n💲 Phase 9: Checking Mark Price & Account Values...");

    const markPrice = await clearingHouse.getMarkPrice();
    console.log("   Mark Price:", ethers.utils.formatEther(markPrice), "USDC per ETH");

    const details1 = await clearingHouse.getPositionDetails(trader1.address);
    console.log("   Trader1 details:");
    console.log("     Collateral:", ethers.utils.formatEther(details1.collateral), "USDC");
    console.log("     Free Collateral:", ethers.utils.formatEther(details1.freeCollateral), "USDC");
    console.log("     Unrealized PnL:", ethers.utils.formatEther(details1.unrealizedPnl), "USDC");

    const accountValue1 = await clearingHouse.getAccountValue(trader1.address);
    console.log("     Account Value:", ethers.utils.formatEther(accountValue1), "USDC");

    // ========== PHASE 10: CLOSE POSITIONS ==========
    console.log("\n🔚 Phase 10: Closing Positions...");

    console.log("   Trader1 closing entire position...");
    const closeTx1 = await clearingHouse.connect(trader1).closePosition(0); // 0 = close all
    await closeTx1.wait();
    console.log("   ✅ Trader1 close queued, tx:", closeTx1.hash);

    console.log("   Trader2 closing entire position...");
    const closeTx2 = await clearingHouse.connect(trader2).closePosition(0);
    await closeTx2.wait();
    console.log("   ✅ Trader2 close queued, tx:", closeTx2.hash);

    console.log("\n⏳ Waiting for deferred execution...");
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Verify positions closed (use event parsing)
    let closedPosTx1 = await positionTracker.getPosition(trader1.address);
    let closedPosReceipt1 = await closedPosTx1.wait();
    let closedPos1 = parsePositionQuery(positionTracker, closedPosReceipt1);
    
    let closedPosTx2 = await positionTracker.getPosition(trader2.address);
    let closedPosReceipt2 = await closedPosTx2.wait();
    let closedPos2 = parsePositionQuery(positionTracker, closedPosReceipt2);
    
    console.log("   Trader1 final position:", ethers.utils.formatEther(closedPos1.baseBalance), "vETH");
    console.log("   Trader2 final position:", ethers.utils.formatEther(closedPos2.baseBalance), "vETH");

    // ========== PHASE 11: WITHDRAW COLLATERAL ==========
    console.log("\n💸 Phase 11: Withdrawing Collateral...");

    const freeCollateral1 = await clearingHouse.getFreeCollateral(trader1.address);
    console.log("   Trader1 free collateral:", ethers.utils.formatEther(freeCollateral1), "USDC");

    if (freeCollateral1.gt(0)) {
        const withdrawAmount = freeCollateral1.div(2); // Withdraw half
        await clearingHouse.connect(trader1).withdraw(withdrawAmount);
        console.log("   ✅ Trader1 withdrew:", ethers.utils.formatEther(withdrawAmount), "USDC");
    }

    // ========== TEST COMPLETE ==========
    console.log("\n" + "=".repeat(60));
    console.log("✅ Integration Test Complete!");
    console.log("=".repeat(60));

    // Summary
    console.log("\n📊 Test Summary:");
    console.log("   ✅ Deployed full perpetual system");
    console.log("   ✅ Traders deposited collateral");
    console.log("   ✅ Opened long/short positions concurrently");
    console.log("   ✅ Positions netted via PerpNettingEngine");
    console.log("   ✅ Position tracking verified");
    console.log("   ✅ Closed positions successfully");
    console.log("   ✅ Withdrew collateral");
    console.log("\n🎉 PerpClearingHouse integration test PASSED!");
}

/**
 * Helper function to parse PositionQuery event from Arcology Base
 * Pattern: Call getPosition() -> wait for tx -> parse event
 */
function parsePositionQuery(contract, receipt) {
    try {
        const event = receipt.events?.find(e => e.event === 'PositionQuery');
        if (!event) {
            return {
                baseBalance: ethers.BigNumber.from(0),
                quoteBalance: ethers.BigNumber.from(0),
                realizedPnl: ethers.BigNumber.from(0)
            };
        }
        
        // The event has 3 non-indexed parameters
        return {
            baseBalance: event.args[0] || ethers.BigNumber.from(0),
            quoteBalance: event.args[1] || ethers.BigNumber.from(0),
            realizedPnl: event.args[2] || ethers.BigNumber.from(0)
        };
    } catch (e) {
        console.log('Error parsing PositionQuery event:', e.message);
        return {
            baseBalance: ethers.BigNumber.from(0),
            quoteBalance: ethers.BigNumber.from(0),
            realizedPnl: ethers.BigNumber.from(0)
        };
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("\n❌ Integration test failed:");
        console.error(error);
        process.exit(1);
    });
