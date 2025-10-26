const hre = require("hardhat");
var frontendUtil = require('@arcologynetwork/frontend-util/utils/util');
const nets = require('../../network.json');

/**
 * Perpetual Trading System Benchmark Generator
 * 
 * This script:
 * 1. Deploys full perpetual infrastructure (mirrors test-clearing-house.js)
 * 2. Tests successful operations: deposits, position queueing
 * 3. Generates pre-signed transactions for load testing
 * 4. Focuses on operations that currently work (Phase 1-7)
 * 
 * Run: npx hardhat run benchmark/perp/gen-tx-perp.js --network TestnetInfo
 */

async function main() {
  const accounts = await ethers.getSigners();
  const provider = new ethers.providers.JsonRpcProvider(nets[hre.network.name].url);
  const pkCreator = nets[hre.network.name].accounts[0];
  const signerCreator = new ethers.Wallet(pkCreator, provider);
  
  const txbase = 'benchmark/perp/txs';
  frontendUtil.ensurePath(txbase);

  console.log("\n" + "=".repeat(80));
  console.log("🧪 PERPETUAL TRADING SYSTEM BENCHMARK");
  console.log("=".repeat(80));
  console.log("Network:", hre.network.name);
  console.log("Deployer:", accounts[0].address);
  console.log("=".repeat(80) + "\n");

  // Configuration
  const traderCount = 10; // Number of traders for benchmark
  const depositAmount = ethers.utils.parseEther("5000"); // 5,000 USDC per trader
  const positionSize = ethers.utils.parseEther("1"); // 1 vETH per position

  // Flags to control test phases
  const flag0_deploy = true;
  const flag1_deposits = true;
  const flag2_positions = true;
  const flag3_generate_txs = false; // Set to true for load testing

  let tx, receipt;

  // ========== PHASE 1: DEPLOY INFRASTRUCTURE ==========
  if (flag0_deploy) {
    console.log("\n📦 PHASE 1: DEPLOYING INFRASTRUCTURE");
    console.log("-".repeat(80));
  }

  const {
    factory,
    router,
    positionManager,
    USDC,
    vETH,
    vUSDC,
    pool,
    positionTracker,
    vault,
    perpNetting,
    perpNettingEngine,
    clearingHouse
  } = await deployPerpInfrastructure(flag0_deploy);

  // ========== PHASE 2: FUND TRADERS ==========
  if (flag1_deposits) {
    console.log("\n💰 PHASE 2: FUNDING TRADERS");
    console.log("-".repeat(80));
    
    const traders = accounts.slice(1, traderCount + 1);
    console.log(`Funding ${traders.length} traders with ${ethers.utils.formatEther(depositAmount)} USDC each...`);
    
    for (let i = 0; i < traders.length; i++) {
      tx = await USDC.transfer(traders[i].address, depositAmount);
      await tx.wait();
      console.log(`✅ Trader ${i + 1} (${traders[i].address}) funded`);
    }
  }

  // ========== PHASE 3: DEPOSIT COLLATERAL (IMMEDIATE OPERATIONS) ==========
  if (flag1_deposits) {
    console.log("\n🏦 PHASE 3: DEPOSITING COLLATERAL (Immediate Operations)");
    console.log("-".repeat(80));
    
    const traders = accounts.slice(1, traderCount + 1);
    
    for (let i = 0; i < traders.length; i++) {
      // Approve
      tx = await USDC.connect(traders[i]).approve(clearingHouse.address, depositAmount);
      await tx.wait();
      
      // Deposit
      tx = await clearingHouse.connect(traders[i]).deposit(depositAmount);
      receipt = await tx.wait();
      frontendUtil.showResult(frontendUtil.parseReceipt(receipt));
      
      console.log(`✅ Trader ${i + 1} deposited ${ethers.utils.formatEther(depositAmount)} USDC`);
    }

    // Verify deposits
    console.log("\n📊 Verifying vault balances...");
    for (let i = 0; i < traders.length; i++) {
      const balance = await vault.balances(traders[i].address);
      console.log(`   Trader ${i + 1}: ${ethers.utils.formatEther(balance)} USDC`);
      
      if (!balance.eq(depositAmount)) {
        throw new Error(`❌ Trader ${i + 1} balance mismatch! Expected ${ethers.utils.formatEther(depositAmount)}, got ${ethers.utils.formatEther(balance)}`);
      }
    }
    console.log("✅ All deposits verified!");
  }

  // ========== PHASE 4: QUEUE POSITIONS (DEFERRED OPERATIONS) ==========
  if (flag2_positions) {
    console.log("\n📊 PHASE 4: QUEUEING POSITIONS (Deferred Operations)");
    console.log("-".repeat(80));
    
    const traders = accounts.slice(1, traderCount + 1);
    
    // Half traders go long, half go short
    const longTraders = traders.slice(0, Math.floor(traders.length / 2));
    const shortTraders = traders.slice(Math.floor(traders.length / 2));
    
    console.log(`Queueing ${longTraders.length} LONG positions...`);
    for (let i = 0; i < longTraders.length; i++) {
      tx = await clearingHouse.connect(longTraders[i]).openPosition(
        true, // isLong
        positionSize,
        0, // amountOutMinimum
        Math.floor(Date.now() / 1000) + 60 * 10 // deadline
      );
      receipt = await tx.wait();
      frontendUtil.showResult(frontendUtil.parseReceipt(receipt));
      console.log(`✅ Trader ${i + 1} queued LONG ${ethers.utils.formatEther(positionSize)} vETH`);
    }
    
    console.log(`\nQueueing ${shortTraders.length} SHORT positions...`);
    for (let i = 0; i < shortTraders.length; i++) {
      tx = await clearingHouse.connect(shortTraders[i]).openPosition(
        false, // isLong
        positionSize,
        0, // amountOutMinimum
        Math.floor(Date.now() / 1000) + 60 * 10 // deadline
      );
      receipt = await tx.wait();
      frontendUtil.showResult(frontendUtil.parseReceipt(receipt));
      console.log(`✅ Trader ${longTraders.length + i + 1} queued SHORT ${ethers.utils.formatEther(positionSize)} vETH`);
    }
    
    console.log("\n✅ All positions queued successfully!");
    console.log("⏳ Waiting for deferred execution...");
    
    // Wait for deferred execution
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log("\n📊 Checking position tracker...");
    console.log("NOTE: Phase 8 issue - positions may show 0 balances after deferred execution");
    console.log("This is the current blocker being debugged in test-clearing-house.js");
  }

  // ========== PHASE 5: GENERATE PRE-SIGNED TRANSACTIONS ==========
  if (flag3_generate_txs) {
    console.log("\n📝 PHASE 5: GENERATING PRE-SIGNED TRANSACTIONS");
    console.log("-".repeat(80));
    console.log("Generating transaction files for load testing...");
    
    const txfile_deposits = `${txbase}/deposits.txt`;
    const txfile_long = `${txbase}/open-long.txt`;
    const txfile_short = `${txbase}/open-short.txt`;
    
    // Clear existing files
    frontendUtil.clearFile(txfile_deposits);
    frontendUtil.clearFile(txfile_long);
    frontendUtil.clearFile(txfile_short);
    
    const traders = accounts.slice(1, traderCount + 1);
    
    // Generate deposit transactions
    for (let i = 0; i < traders.length; i++) {
      const signer = new ethers.Wallet(nets[hre.network.name].accounts[i + 1], provider);
      
      // Approve transaction
      const approveTx = await clearingHouse.populateTransaction.deposit(depositAmount);
      await writePreSignedTxFile(txfile_deposits, signer, approveTx);
    }
    
    // Generate long position transactions
    for (let i = 0; i < Math.floor(traders.length / 2); i++) {
      const signer = new ethers.Wallet(nets[hre.network.name].accounts[i + 1], provider);
      
      const openTx = await clearingHouse.populateTransaction.openPosition(
        true,
        positionSize,
        0,
        Math.floor(Date.now() / 1000) + 60 * 10
      );
      await writePreSignedTxFile(txfile_long, signer, openTx);
    }
    
    // Generate short position transactions
    for (let i = Math.floor(traders.length / 2); i < traders.length; i++) {
      const signer = new ethers.Wallet(nets[hre.network.name].accounts[i + 1], provider);
      
      const openTx = await clearingHouse.populateTransaction.openPosition(
        false,
        positionSize,
        0,
        Math.floor(Date.now() / 1000) + 60 * 10
      );
      await writePreSignedTxFile(txfile_short, signer, openTx);
    }
    
    console.log(`✅ Generated transaction files:`);
    console.log(`   - ${txfile_deposits}`);
    console.log(`   - ${txfile_long}`);
    console.log(`   - ${txfile_short}`);
  }

  // ========== SUMMARY ==========
  console.log("\n" + "=".repeat(80));
  console.log("✅ BENCHMARK COMPLETED");
  console.log("=".repeat(80));
  console.log("Deployment addresses:");
  console.log("  Factory:", factory.address);
  console.log("  Router:", router.address);
  console.log("  USDC:", USDC.address);
  console.log("  vETH:", vETH.address);
  console.log("  vUSDC:", vUSDC.address);
  console.log("  Pool:", pool.address);
  console.log("  PositionTracker:", positionTracker.address);
  console.log("  CollateralVault:", vault.address);
  console.log("  PerpNetting:", perpNetting.address);
  console.log("  PerpNettingEngine:", perpNettingEngine.address);
  console.log("  PerpClearingHouse:", clearingHouse.address);
  console.log("=".repeat(80));
  console.log("\n✅ Successfully tested:");
  console.log("  ✅ Phase 1-3: Infrastructure deployment");
  console.log("  ✅ Phase 4: Trader funding");
  console.log("  ✅ Phase 5: Collateral deposits (IMMEDIATE)");
  console.log("  ✅ Phase 6: Position queueing (DEFERRED - queueing works)");
  console.log("\n⚠️  Known issue:");
  console.log("  ⏸️  Phase 8: Position updates after deferred execution");
  console.log("     - Positions queued successfully");
  console.log("     - Deferred execution may not update PositionTracker");
  console.log("     - This is the current blocker in test-clearing-house.js");
  console.log("=".repeat(80) + "\n");
}

// ========== HELPER FUNCTIONS ==========

async function deployPerpInfrastructure(shouldDeploy) {
  if (!shouldDeploy) {
    console.log("⏭️  Skipping deployment (flag0_deploy = false)");
    return {};
  }

  const [deployer] = await ethers.getSigners();

  // Deploy Uniswap V3 Factory
  console.log("Deploying UniswapV3Factory...");
  const UniswapV3Factory = await ethers.getContractFactory("UniswapV3Factory");
  const factory = await UniswapV3Factory.deploy();
  await factory.deployed();
  console.log("✅ Factory:", factory.address);

  // Deploy WETH9
  console.log("Deploying WETH9...");
  const WETH9 = await ethers.getContractFactory("WETH9");
  const weth9 = await WETH9.deploy();
  await weth9.deployed();
  console.log("✅ WETH9:", weth9.address);

  // Deploy NFTDescriptor
  console.log("Deploying NFTDescriptor...");
  const NFTDescriptor = await ethers.getContractFactory("NFTDescriptor");
  const nftDescriptor = await NFTDescriptor.deploy();
  await nftDescriptor.deployed();
  console.log("✅ NFTDescriptor:", nftDescriptor.address);

  // Deploy NonfungibleTokenPositionDescriptor
  console.log("Deploying NonfungibleTokenPositionDescriptor...");
  const nativeCurrencyLabelBytes = ethers.utils.formatBytes32String("ACL");
  const NonfungibleTokenPositionDescriptor = await ethers.getContractFactory(
    "NonfungibleTokenPositionDescriptor",
    {
      libraries: {
        NFTDescriptor: nftDescriptor.address,
      },
    }
  );
  const positionDescriptor = await NonfungibleTokenPositionDescriptor.deploy(
    weth9.address,
    nativeCurrencyLabelBytes
  );
  await positionDescriptor.deployed();
  console.log("✅ PositionDescriptor:", positionDescriptor.address);

  // Deploy NonfungiblePositionManager
  console.log("Deploying NonfungiblePositionManager...");
  const NonfungiblePositionManager = await ethers.getContractFactory("NonfungiblePositionManager");
  const positionManager = await NonfungiblePositionManager.deploy(
    factory.address,
    weth9.address,
    positionDescriptor.address
  );
  await positionManager.deployed();
  console.log("✅ PositionManager:", positionManager.address);

  // Deploy SwapRouter
  console.log("Deploying SwapRouter...");
  const SwapRouter = await ethers.getContractFactory("SwapRouter");
  const router = await SwapRouter.deploy(factory.address, weth9.address);
  await router.deployed();
  console.log("✅ Router:", router.address);

  // Deploy USDC (using Token.sol)
  console.log("Deploying USDC...");
  const Token = await ethers.getContractFactory("Token");
  const USDC = await Token.deploy("USD Coin", "USDC");
  await USDC.deployed();
  console.log("✅ USDC:", USDC.address);

  // Mint initial USDC supply
  const initialSupply = ethers.utils.parseEther("1000000000"); // 1 billion USDC
  let tx = await USDC.mint(deployer.address, initialSupply);
  await tx.wait();
  console.log("✅ Minted initial USDC supply");

  // Deploy Virtual Tokens
  console.log("Deploying VirtualToken (vETH)...");
  const VirtualToken = await ethers.getContractFactory("VirtualToken");
  const vETH = await VirtualToken.deploy("Virtual ETH", "vETH");
  await vETH.deployed();
  console.log("✅ vETH:", vETH.address);

  console.log("Deploying VirtualToken (vUSDC)...");
  const vUSDC = await VirtualToken.deploy("Virtual USDC", "vUSDC");
  await vUSDC.deployed();
  console.log("✅ vUSDC:", vUSDC.address);

  // Deploy PositionTracker
  console.log("Deploying PositionTracker...");
  const PositionTracker = await ethers.getContractFactory("PositionTracker");
  const positionTracker = await PositionTracker.deploy();
  await positionTracker.deployed();
  console.log("✅ PositionTracker:", positionTracker.address);

  // Deploy CollateralVault
  console.log("Deploying CollateralVault...");
  const CollateralVault = await ethers.getContractFactory("CollateralVault");
  const vault = await CollateralVault.deploy(USDC.address);
  await vault.deployed();
  console.log("✅ CollateralVault:", vault.address);

  // Deploy PerpNetting
  console.log("Deploying PerpNetting...");
  const PerpNetting = await ethers.getContractFactory("PerpNetting");
  const perpNetting = await PerpNetting.deploy(router.address);
  await perpNetting.deployed();
  console.log("✅ PerpNetting:", perpNetting.address);

  // Deploy PerpNettingEngine
  console.log("Deploying PerpNettingEngine...");
  const PerpNettingEngine = await ethers.getContractFactory("PerpNettingEngine");
  const perpNettingEngine = await PerpNettingEngine.deploy();
  await perpNettingEngine.deployed();
  console.log("✅ PerpNettingEngine:", perpNettingEngine.address);

  // Initialize NettingEngine base
  console.log("Initializing NettingEngine...");
  tx = await perpNettingEngine.init(factory.address, perpNetting.address);
  let receipt = await tx.wait();
  frontendUtil.showResult(frontendUtil.parseReceipt(receipt));

  // Create Pool
  console.log("Creating vETH/vUSDC pool...");
  const fee = 3000; // 0.3%
  tx = await factory.createPool(vETH.address, vUSDC.address, fee);
  receipt = await tx.wait();
  frontendUtil.showResult(frontendUtil.parseReceipt(receipt));

  const poolCreatedEvent = receipt.events?.find(e => e.event === 'PoolCreated');
  const poolAddress = poolCreatedEvent?.args?.pool;
  console.log("✅ Pool created:", poolAddress);

  const pool = await ethers.getContractAt("UniswapV3Pool", poolAddress);

  // Get token ordering
  const token0 = await pool.token0();
  const token1 = await pool.token1();
  console.log("   token0:", token0, "(", token0 === vETH.address ? "vETH" : "vUSDC", ")");
  console.log("   token1:", token1, "(", token1 === vETH.address ? "vETH" : "vUSDC", ")");

  // Deploy PerpClearingHouse
  console.log("Deploying PerpClearingHouse...");
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
  console.log("✅ PerpClearingHouse:", clearingHouse.address);

  // Initialize PerpNettingEngine with perp components
  console.log("Initializing PerpNettingEngine perp components...");
  tx = await perpNettingEngine.initPerp(
    positionTracker.address,
    clearingHouse.address,
    perpNetting.address
  );
  receipt = await tx.wait();
  frontendUtil.showResult(frontendUtil.parseReceipt(receipt));

  // Initialize pool in PerpNettingEngine
  console.log("Initializing pool in PerpNettingEngine...");
  tx = await perpNettingEngine.initPerpPool(poolAddress, token0, token1);
  receipt = await tx.wait();
  frontendUtil.showResult(frontendUtil.parseReceipt(receipt));

  // Set clearingHouse in vault
  console.log("Authorizing ClearingHouse in vault...");
  tx = await vault.setClearingHouse(clearingHouse.address);
  receipt = await tx.wait();
  frontendUtil.showResult(frontendUtil.parseReceipt(receipt));

  // Whitelist perpNetting and pool
  console.log("Whitelisting PerpNetting in virtual tokens...");
  tx = await vETH.addToWhitelist(perpNetting.address);
  await tx.wait();
  tx = await vUSDC.addToWhitelist(perpNetting.address);
  await tx.wait();
  console.log("✅ PerpNetting whitelisted");

  console.log("Whitelisting pool in virtual tokens...");
  tx = await vETH.addToWhitelist(poolAddress);
  await tx.wait();
  tx = await vUSDC.addToWhitelist(poolAddress);
  await tx.wait();
  console.log("✅ Pool whitelisted");

  // Initialize pool price: 1 ETH = 2000 USDC
  console.log("Initializing pool price (1 ETH = 2000 USDC)...");
  let sqrtPriceX96;
  if (token0 === vETH.address) {
    // token0 = vETH, token1 = vUSDC
    // price = token1/token0 = 2000/1 = 2000
    sqrtPriceX96 = ethers.BigNumber.from("3541774025502087823568"); // sqrt(2000) * 2^96
  } else {
    // token0 = vUSDC, token1 = vETH
    // price = token1/token0 = 1/2000 = 0.0005
    sqrtPriceX96 = ethers.BigNumber.from("1771362431969880370"); // sqrt(0.0005) * 2^96
  }
  tx = await pool.initialize(sqrtPriceX96);
  receipt = await tx.wait();
  frontendUtil.showResult(frontendUtil.parseReceipt(receipt));

  // Add liquidity via NonfungiblePositionManager
  console.log("Adding liquidity to pool...");
  const liquidityVETH = ethers.utils.parseEther("100");
  const liquidityVUSDC = ethers.utils.parseEther("200000");

  // Whitelist deployer and positionManager
  tx = await vETH.addToWhitelist(deployer.address);
  await tx.wait();
  tx = await vUSDC.addToWhitelist(deployer.address);
  await tx.wait();
  tx = await vETH.addToWhitelist(positionManager.address);
  await tx.wait();
  tx = await vUSDC.addToWhitelist(positionManager.address);
  await tx.wait();

  // Mint tokens
  tx = await vETH.mint(deployer.address, liquidityVETH);
  await tx.wait();
  tx = await vUSDC.mint(deployer.address, liquidityVUSDC);
  await tx.wait();

  // Approve positionManager
  tx = await vETH.approve(positionManager.address, liquidityVETH);
  await tx.wait();
  tx = await vUSDC.approve(positionManager.address, liquidityVUSDC);
  await tx.wait();

  // Prepare liquidity amounts based on token ordering
  const amount0Desired = token0 === vETH.address ? liquidityVETH : liquidityVUSDC;
  const amount1Desired = token0 === vETH.address ? liquidityVUSDC : liquidityVETH;

  // Mint liquidity via NonfungiblePositionManager
  const params = {
    token0: token0,
    token1: token1,
    fee: fee,
    tickLower: -887220,
    tickUpper: 887220,
    amount0Desired: amount0Desired,
    amount1Desired: amount1Desired,
    amount0Min: 0,
    amount1Min: 0,
    recipient: deployer.address,
    deadline: Math.floor(Date.now() / 1000) + 60 * 20,
  };

  tx = await positionManager.mint(params, {
    gasLimit: 500000000,
  });
  receipt = await tx.wait();
  frontendUtil.showResult(frontendUtil.parseReceipt(receipt));
  console.log("✅ Liquidity added");

  return {
    factory,
    router,
    positionManager,
    USDC,
    vETH,
    vUSDC,
    pool,
    positionTracker,
    vault,
    perpNetting,
    perpNettingEngine,
    clearingHouse
  };
}

async function writePreSignedTxFile(txfile, signer, tx) {
  const fulltx = await signer.populateTransaction(tx);
  const rawtx = await signer.signTransaction(fulltx);
  frontendUtil.appendTo(txfile, rawtx + ',\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
