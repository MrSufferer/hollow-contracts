const hre = require("hardhat");
const nets = require('../../network.json');

/**
 * Full Liquidity Addition Test - Similar to gen-tx-uniswap.js
 * 
 * This test demonstrates the complete liquidity addition flow including:
 * 1. Deploy full Uniswap V3 infrastructure (Factory, WETH9, NFTDescriptor, etc.)
 * 2. Deploy Token.sol (Arcology concurrent ERC20) instead of VirtualToken
 * 3. Create pools with Token.sol
 * 4. Add liquidity using NonfungiblePositionManager
 * 5. Verify liquidity was added successfully
 * 
 * Must run on Arcology TestnetInfo network:
 * npx hardhat run test/integration/test-full-liquidity.js --network TestnetInfo
 */

async function main() {
    console.log("\n========================================");
    console.log("Full Liquidity Addition Test (like gen-tx-uniswap.js)");
    console.log("Network:", hre.network.name);
    console.log("========================================\n");

    // Get accounts
    const accounts = await ethers.getSigners();
    const [deployer, liquidityProvider] = accounts;
    
    console.log("Deployer:", deployer.address);
    console.log("Liquidity Provider:", liquidityProvider.address);

    // Step 1: Deploy base Uniswap V3 infrastructure
    console.log("\n--- Step 1: Deploy Base Uniswap V3 Infrastructure ---");
    const { factory, weth9, router, positionManager } = await deployBaseContracts();

    // Step 2: Deploy Token contracts (Arcology concurrent ERC20)
    console.log("\n--- Step 2: Deploy Token Contracts ---");
    const { tokenA, tokenB } = await deployTokens();

    // Step 3: Create pool
    console.log("\n--- Step 3: Create Pool ---");
    const pool = await createPool(factory, tokenA, tokenB);

    // Step 4: Initialize pool price
    console.log("\n--- Step 4: Initialize Pool Price ---");
    await initializePoolPrice(pool);

    // Step 5: Mint tokens for liquidity provider
    console.log("\n--- Step 5: Mint Tokens for Liquidity Provider ---");
    await mintTokens(tokenA, tokenB, liquidityProvider);

    // Step 6: Approve position manager
    console.log("\n--- Step 6: Approve NonfungiblePositionManager ---");
    await approvePositionManager(tokenA, tokenB, positionManager, liquidityProvider);

    // Step 7: Add liquidity
    console.log("\n--- Step 7: Add Liquidity ---");
    await addLiquidity(tokenA, tokenB, positionManager, liquidityProvider);

    console.log("\n========================================");
    console.log("✅ Full Liquidity Addition Test PASSED!");
    console.log("========================================");
    console.log("\nKey Verifications:");
    console.log("✅ Full Uniswap V3 infrastructure deployed");
    console.log("✅ Token.sol (Arcology concurrent) works with Uniswap");
    console.log("✅ Pool created and initialized");
    console.log("✅ Liquidity added successfully via NonfungiblePositionManager");
    console.log("========================================\n");
}

async function deployBaseContracts() {
    console.log("Deploying UniswapV3Factory...");
    const UniswapV3Factory = await ethers.getContractFactory("UniswapV3Factory");
    const factory = await UniswapV3Factory.deploy();
    await factory.deployed();
    console.log("✅ UniswapV3Factory:", factory.address);

    console.log("Deploying WETH9...");
    const WETH9 = await ethers.getContractFactory("WETH9");
    const weth9 = await WETH9.deploy();
    await weth9.deployed();
    console.log("✅ WETH9:", weth9.address);

    console.log("Deploying NFTDescriptor library...");
    const NFTDescriptor = await ethers.getContractFactory("NFTDescriptor");
    const nftDescriptor = await NFTDescriptor.deploy();
    await nftDescriptor.deployed();
    console.log("✅ NFTDescriptor:", nftDescriptor.address);

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
    console.log("✅ NonfungibleTokenPositionDescriptor:", positionDescriptor.address);

    console.log("Deploying NonfungiblePositionManager...");
    const NonfungiblePositionManager = await ethers.getContractFactory("NonfungiblePositionManager");
    const positionManager = await NonfungiblePositionManager.deploy(
        factory.address,
        weth9.address,
        positionDescriptor.address
    );
    await positionManager.deployed();
    console.log("✅ NonfungiblePositionManager:", positionManager.address);

    console.log("Deploying SwapRouter...");
    const SwapRouter = await ethers.getContractFactory("SwapRouter");
    const router = await SwapRouter.deploy(factory.address, weth9.address);
    await router.deployed();
    console.log("✅ SwapRouter:", router.address);

    return { factory, weth9, router, positionManager };
}

async function deployTokens() {
    console.log("Deploying Token A (Arcology concurrent ERC20)...");
    const TokenFactory = await ethers.getContractFactory("Token");
    const tokenA = await TokenFactory.deploy("Token A", "TKNA");
    await tokenA.deployed();
    console.log("✅ Token A:", tokenA.address);

    console.log("Deploying Token B (Arcology concurrent ERC20)...");
    const tokenB = await TokenFactory.deploy("Token B", "TKNB");
    await tokenB.deployed();
    console.log("✅ Token B:", tokenB.address);

    return { tokenA, tokenB };
}

async function createPool(factory, tokenA, tokenB) {
    const fee = 3000; // 0.3%

    console.log("Creating pool (Token A / Token B)...");
    let tx = await factory.createPool(tokenA.address, tokenB.address, fee);
    let receipt = await tx.wait();
    
    // Parse PoolCreated event
    const poolCreatedEvent = receipt.events?.find(e => e.event === 'PoolCreated');
    const poolAddress = poolCreatedEvent?.args?.pool;
    console.log("✅ Pool created:", poolAddress);

    const pool = await ethers.getContractAt("UniswapV3Pool", poolAddress);
    return pool;
}

async function initializePoolPrice(pool) {
    // Set initial price: 1:4 ratio (Token A : Token B)
    // sqrtPriceX96 = sqrt(price) * 2^96
    // For 4:1 ratio: sqrt(4) * 2^96 = 2 * 2^96
    const sqrtPriceX96 = ethers.BigNumber.from("79228162514264337593543950336").mul(2); // 2^96 * 2
    
    console.log("Initializing pool price (1 Token A = 4 Token B)...");
    const tx = await pool.initialize(sqrtPriceX96);
    await tx.wait();
    console.log("✅ Pool price initialized");
}

async function mintTokens(tokenA, tokenB, recipient) {
    const amountA = ethers.utils.parseUnits("80000000", 18); // 80M Token A
    const amountB = ethers.utils.parseUnits("320000000", 18); // 320M Token B (4x for the 1:4 ratio)

    console.log("Minting Token A...");
    let tx = await tokenA.mint(recipient.address, amountA);
    await tx.wait();
    console.log(`✅ Minted ${ethers.utils.formatUnits(amountA, 18)} Token A`);

    console.log("Minting Token B...");
    tx = await tokenB.mint(recipient.address, amountB);
    await tx.wait();
    console.log(`✅ Minted ${ethers.utils.formatUnits(amountB, 18)} Token B`);
}

async function approvePositionManager(tokenA, tokenB, positionManager, signer) {
    const maxApproval = ethers.constants.MaxUint256;

    console.log("Approving Token A...");
    let tx = await tokenA.connect(signer).approve(positionManager.address, maxApproval);
    await tx.wait();
    console.log("✅ Token A approved");

    console.log("Approving Token B...");
    tx = await tokenB.connect(signer).approve(positionManager.address, maxApproval);
    await tx.wait();
    console.log("✅ Token B approved");
}

async function addLiquidity(tokenA, tokenB, positionManager, signer) {
    const fee = 3000; // 0.3%
    const amountA = ethers.utils.parseUnits("80000000", 18); // 80M Token A
    const amountB = ethers.utils.parseUnits("320000000", 18); // 320M Token B

    // Determine token order (token0 < token1)
    const token0 = tokenA.address.toLowerCase() < tokenB.address.toLowerCase() ? tokenA.address : tokenB.address;
    const token1 = tokenA.address.toLowerCase() < tokenB.address.toLowerCase() ? tokenB.address : tokenA.address;
    const amount0Desired = token0 === tokenA.address ? amountA : amountB;
    const amount1Desired = token0 === tokenA.address ? amountB : amountA;

    console.log("Adding liquidity to pool...");
    console.log(`   Token0 (${token0 === tokenA.address ? 'Token A' : 'Token B'}): ${ethers.utils.formatUnits(amount0Desired, 18)}`);
    console.log(`   Token1 (${token1 === tokenA.address ? 'Token A' : 'Token B'}): ${ethers.utils.formatUnits(amount1Desired, 18)}`);

    const mintParams = {
        token0: token0,
        token1: token1,
        fee: fee,
        tickLower: -887220, // Full range liquidity
        tickUpper: 887220,
        amount0Desired: amount0Desired,
        amount1Desired: amount1Desired,
        amount0Min: 0,
        amount1Min: 0,
        recipient: signer.address,
        deadline: Math.floor(Date.now() / 1000) + 60 * 20, // 20 minutes
    };

    const mintTx = await positionManager.connect(signer).mint(mintParams, {
        gasLimit: 30000000,
    });
    const mintReceipt = await mintTx.wait();
    console.log("✅ Liquidity added successfully");
    console.log(`   Transaction: ${mintReceipt.transactionHash}`);
    console.log(`   Gas used: ${mintReceipt.gasUsed.toString()}`);
    
    // Find the IncreaseLiquidity event to get actual amounts
    const increaseLiqEvent = mintReceipt.events?.find(e => e.event === 'IncreaseLiquidity');
    if (increaseLiqEvent) {
        console.log(`   Liquidity: ${increaseLiqEvent.args.liquidity.toString()}`);
        console.log(`   Amount0: ${ethers.utils.formatUnits(increaseLiqEvent.args.amount0, 18)}`);
        console.log(`   Amount1: ${ethers.utils.formatUnits(increaseLiqEvent.args.amount1, 18)}`);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("\n❌ Test failed:");
        console.error(error);
        process.exit(1);
    });
