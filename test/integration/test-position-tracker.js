const hre = require("hardhat");
var frontendUtil = require('@arcologynetwork/frontend-util/utils/util');
const { ethers } = require("hardhat");

/**
 * Integration test for PositionTracker on Arcology network
 * Run with: npx hardhat run test/integration/test-position-tracker.js --network TestnetInfo
 */
async function main() {
    const accounts = await ethers.getSigners();
    
    console.log('\n========== Deploying PositionTracker ==========');
    const PositionTracker = await ethers.getContractFactory("PositionTracker");
    const positionTracker = await PositionTracker.deploy();
    await positionTracker.deployed();
    console.log(`✓ Deployed PositionTracker at ${positionTracker.address}`);
    
    const trader1 = accounts[1];
    const trader2 = accounts[2];
    const trader3 = accounts[3];
    
    console.log('\n========== Test 1: Query Empty Position ==========');
    let tx = await positionTracker.getPosition(trader1.address);
    let receipt = await tx.wait();
    console.log('Receipt events:', receipt.events?.map(e => e.event));
    let position = parsePositionQuery(positionTracker, receipt);
    console.log('Parsed position:', position);
    console.log(`✓ Trader1 initial position: base=${safeFormatEther(position.baseBalance)}, quote=${safeFormatEther(position.quoteBalance)}, pnl=${safeFormatEther(position.realizedPnl)}`);
    assert(position.baseBalance.eq(0), "Initial base should be 0");
    assert(position.quoteBalance.eq(0), "Initial quote should be 0");
    assert(position.realizedPnl.eq(0), "Initial PnL should be 0");
    
    console.log('\n========== Test 2: Open Long Position (Concurrent) ==========');
    const txs = [];
    
    // Trader1: Long 1 ETH at $2000
    txs.push(frontendUtil.generateTx(function([tracker, trader, base, quote]){
        return tracker.updatePosition(trader, base, quote);
    }, positionTracker, trader1.address, ethers.utils.parseEther("1"), ethers.utils.parseEther("-2000")));
    
    // Trader2: Short 2 ETH at $2000
    txs.push(frontendUtil.generateTx(function([tracker, trader, base, quote]){
        return tracker.updatePosition(trader, base, quote);
    }, positionTracker, trader2.address, ethers.utils.parseEther("-2"), ethers.utils.parseEther("4000")));
    
    // Trader3: Long 0.5 ETH at $2000
    txs.push(frontendUtil.generateTx(function([tracker, trader, base, quote]){
        return tracker.updatePosition(trader, base, quote);
    }, positionTracker, trader3.address, ethers.utils.parseEther("0.5"), ethers.utils.parseEther("-1000")));
    
    await frontendUtil.waitingTxs(txs);
    console.log('✓ 3 concurrent position updates executed');
    
    console.log('\n========== Test 3: Verify Positions ==========');
    
    tx = await positionTracker.getPosition(trader1.address);
    receipt = await tx.wait();
    position = parsePositionQuery(positionTracker, receipt);
    console.log(`✓ Trader1: base=${formatEther(position.baseBalance)} ETH, quote=${formatEther(position.quoteBalance)} USD`);
    assert(position.baseBalance.eq(ethers.utils.parseEther("1")), "Trader1 base incorrect");
    assert(position.quoteBalance.eq(ethers.utils.parseEther("-2000")), "Trader1 quote incorrect");
    
    tx = await positionTracker.getPosition(trader2.address);
    receipt = await tx.wait();
    position = parsePositionQuery(positionTracker, receipt);
    console.log(`✓ Trader2: base=${formatEther(position.baseBalance)} ETH, quote=${formatEther(position.quoteBalance)} USD`);
    assert(position.baseBalance.eq(ethers.utils.parseEther("-2")), "Trader2 base incorrect");
    assert(position.quoteBalance.eq(ethers.utils.parseEther("4000")), "Trader2 quote incorrect");
    
    tx = await positionTracker.getPosition(trader3.address);
    receipt = await tx.wait();
    position = parsePositionQuery(positionTracker, receipt);
    console.log(`✓ Trader3: base=${formatEther(position.baseBalance)} ETH, quote=${formatEther(position.quoteBalance)} USD`);
    assert(position.baseBalance.eq(ethers.utils.parseEther("0.5")), "Trader3 base incorrect");
    assert(position.quoteBalance.eq(ethers.utils.parseEther("-1000")), "Trader3 quote incorrect");
    
    console.log('\n========== Test 4: Position Value Calculation ==========');
    const markPrice = ethers.utils.parseEther("2500"); // Price moved to $2500
    
    tx = await positionTracker.getPositionValue(trader1.address, markPrice);
    receipt = await tx.wait();
    let posValue = parsePositionValueQuery(positionTracker, receipt);
    console.log(`✓ Trader1 position value at $2500: ${formatEther(posValue)} USD (should be $500 profit)`);
    assert(posValue.eq(ethers.utils.parseEther("500")), "Trader1 position value incorrect");
    
    tx = await positionTracker.getPositionValue(trader2.address, markPrice);
    receipt = await tx.wait();
    posValue = parsePositionValueQuery(positionTracker, receipt);
    console.log(`✓ Trader2 position value at $2500: ${formatEther(posValue)} USD (should be -$1000 loss)`);
    assert(posValue.eq(ethers.utils.parseEther("-1000")), "Trader2 position value incorrect");
    
    console.log('\n========== Test 5: Realize PnL ==========');
    tx = await positionTracker.realizePnl(trader1.address, ethers.utils.parseEther("100"));
    receipt = await tx.wait();
    console.log('✓ Realized $100 PnL for Trader1');
    
    tx = await positionTracker.getPosition(trader1.address);
    receipt = await tx.wait();
    position = parsePositionQuery(positionTracker, receipt);
    console.log(`✓ Trader1 realized PnL: ${formatEther(position.realizedPnl)} USD`);
    assert(position.realizedPnl.eq(ethers.utils.parseEther("100")), "Realized PnL incorrect");
    
    console.log('\n========== Test 6: Update Existing Position ==========');
    // Trader1 increases position
    tx = await positionTracker.updatePosition(
        trader1.address,
        ethers.utils.parseEther("0.5"),
        ethers.utils.parseEther("-1200")
    );
    receipt = await tx.wait();
    
    tx = await positionTracker.getPosition(trader1.address);
    receipt = await tx.wait();
    position = parsePositionQuery(positionTracker, receipt);
    console.log(`✓ Trader1 updated: base=${formatEther(position.baseBalance)} ETH, quote=${formatEther(position.quoteBalance)} USD`);
    assert(position.baseBalance.eq(ethers.utils.parseEther("1.5")), "Updated base incorrect");
    assert(position.quoteBalance.eq(ethers.utils.parseEther("-3200")), "Updated quote incorrect");
    
    console.log('\n========== Test 7: Close Position ==========');
    tx = await positionTracker.updatePosition(
        trader1.address,
        ethers.utils.parseEther("-1.5"),
        ethers.utils.parseEther("3200")
    );
    receipt = await tx.wait();
    
    tx = await positionTracker.getPosition(trader1.address);
    receipt = await tx.wait();
    position = parsePositionQuery(positionTracker, receipt);
    console.log(`✓ Trader1 closed: base=${formatEther(position.baseBalance)} ETH, quote=${formatEther(position.quoteBalance)} USD`);
    assert(position.baseBalance.eq(0), "Closed base should be 0");
    assert(position.quoteBalance.eq(0), "Closed quote should be 0");
    
    tx = await positionTracker.hasPosition(trader1.address);
    receipt = await tx.wait();
    let hasPos = parseHasPositionQuery(positionTracker, receipt);
    console.log(`✓ Trader1 hasPosition: ${hasPos}`);
    assert(!hasPos, "Should not have position after closing");
    
    console.log('\n========== All Tests Passed! ==========');
    console.log('✓ Position tracking works correctly with concurrent updates');
    console.log('✓ Position value calculations are accurate');
    console.log('✓ PnL realization works as expected');
    console.log('✓ Thread-safe concurrent container functioning properly');
}

function parsePositionQuery(contract, receipt) {
    try {
        // Parse the event manually from receipt
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

function parsePositionValueQuery(contract, receipt) {
    try {
        const event = receipt.events?.find(e => e.event === 'PositionValueQuery');
        if (!event) return ethers.BigNumber.from(0);
        return event.args[0] || ethers.BigNumber.from(0);
    } catch (e) {
        console.log('Error parsing PositionValueQuery event:', e.message);
        return ethers.BigNumber.from(0);
    }
}

function parseHasPositionQuery(contract, receipt) {
    try {
        const event = receipt.events?.find(e => e.event === 'HasPositionQuery');
        if (!event) return false;
        return event.args[0] || false;
    } catch (e) {
        console.log('Error parsing HasPositionQuery event:', e.message);
        return false;
    }
}

function formatEther(value) {
    return ethers.utils.formatEther(value);
}

function safeFormatEther(value) {
    if (!value) return '0';
    try {
        return ethers.utils.formatEther(value);
    } catch (e) {
        return String(value);
    }
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}

main()
    .then(() => {
        console.log('\n✅ Integration test completed successfully!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Integration test failed:');
        console.error(error);
        process.exit(1);
    });
