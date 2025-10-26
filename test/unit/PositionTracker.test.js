const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PositionTracker", function () {
    let positionTracker;
    let owner, trader1, trader2, trader3;
    
    // Helper function to parse PositionQuery event from transaction receipt
    async function getPositionFromTx(trader) {
        const tx = await positionTracker.getPosition(trader);
        const receipt = await tx.wait();
        
        const event = receipt.events?.find(e => e.event === "PositionQuery");
        if (!event) {
            return { baseBalance: ethers.BigNumber.from(0), quoteBalance: ethers.BigNumber.from(0), realizedPnl: ethers.BigNumber.from(0) };
        }
        
        return {
            baseBalance: event.args.baseBalance,
            quoteBalance: event.args.quoteBalance,
            realizedPnl: event.args.realizedPnl
        };
    }
    
    // Helper function to parse PositionValueQuery event
    async function getPositionValueFromTx(trader, markPrice) {
        const tx = await positionTracker.getPositionValue(trader, markPrice);
        const receipt = await tx.wait();
        
        const event = receipt.events?.find(e => e.event === "PositionValueQuery");
        if (!event) {
            return ethers.BigNumber.from(0);
        }
        
        return event.args.positionValue;
    }
    
    // Helper function to parse HasPositionQuery event
    async function hasPositionFromTx(trader) {
        const tx = await positionTracker.hasPosition(trader);
        const receipt = await tx.wait();
        
        const event = receipt.events?.find(e => e.event === "HasPositionQuery");
        if (!event) {
            return false;
        }
        
        return event.args.hasPosition;
    }
    
    beforeEach(async function () {
        [owner, trader1, trader2, trader3] = await ethers.getSigners();
        
        // Deploy MockPositionTracker for unit testing (uses standard storage)
        // Note: Real PositionTracker (with concurrent containers) is tested on Arcology network
        const PositionTracker = await ethers.getContractFactory("MockPositionTracker");
        positionTracker = await PositionTracker.deploy();
        await positionTracker.deployed();
    });
    
    describe("Deployment", function () {
        it("Should deploy successfully", async function () {
            expect(positionTracker.address).to.properAddress;
        });
    });
    
    describe("getPosition", function () {
        it("Should return (0, 0, 0) for new trader with no position", async function () {
            const result = await getPositionFromTx(trader1.address);
            
            expect(result.baseBalance).to.equal(0);
            expect(result.quoteBalance).to.equal(0);
            expect(result.realizedPnl).to.equal(0);
        });
        
        it("Should return default values for multiple new traders", async function () {
            const result1 = await getPositionFromTx(trader1.address);
            const result2 = await getPositionFromTx(trader2.address);
            const result3 = await getPositionFromTx(trader3.address);
            
            expect(result1.baseBalance).to.equal(0);
            expect(result1.quoteBalance).to.equal(0);
            expect(result1.realizedPnl).to.equal(0);
            
            expect(result2.baseBalance).to.equal(0);
            expect(result2.quoteBalance).to.equal(0);
            expect(result2.realizedPnl).to.equal(0);
            
            expect(result3.baseBalance).to.equal(0);
            expect(result3.quoteBalance).to.equal(0);
            expect(result3.realizedPnl).to.equal(0);
        });
    });
    
    describe("updatePosition", function () {
        it("Should create new position for first-time trader (long)", async function () {
            const baseChange = ethers.utils.parseEther("1"); // +1 vETH
            const quoteChange = ethers.utils.parseEther("-2000"); // -2000 vUSDC
            
            await expect(
                positionTracker.updatePosition(trader1.address, baseChange, quoteChange)
            ).to.emit(positionTracker, "PositionUpdated")
              .withArgs(trader1.address, baseChange, quoteChange, 0);
            
            const result = await getPositionFromTx(trader1.address);
            expect(result.baseBalance).to.equal(baseChange);
            expect(result.quoteBalance).to.equal(quoteChange);
            expect(result.realizedPnl).to.equal(0);
        });
        
        it("Should create new position for first-time trader (short)", async function () {
            const baseChange = ethers.utils.parseEther("-1"); // -1 vETH
            const quoteChange = ethers.utils.parseEther("2000"); // +2000 vUSDC
            
            await positionTracker.updatePosition(trader1.address, baseChange, quoteChange);
            
            const result = await getPositionFromTx(trader1.address);
            expect(result.baseBalance).to.equal(baseChange);
            expect(result.quoteBalance).to.equal(quoteChange);
            expect(result.realizedPnl).to.equal(0);
        });
        
        it("Should update existing position (increase long)", async function () {
            // Open initial long position: +1 vETH, -2000 vUSDC
            await positionTracker.updatePosition(
                trader1.address,
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("-2000")
            );
            
            // Increase long position: +0.5 vETH, -1000 vUSDC
            await positionTracker.updatePosition(
                trader1.address,
                ethers.utils.parseEther("0.5"),
                ethers.utils.parseEther("-1000")
            );
            
            const result = await getPositionFromTx(trader1.address);
            expect(result.baseBalance).to.equal(ethers.utils.parseEther("1.5"));
            expect(result.quoteBalance).to.equal(ethers.utils.parseEther("-3000"));
            expect(result.realizedPnl).to.equal(0);
        });
        
        it("Should update existing position (reduce long)", async function () {
            // Open long position: +2 vETH, -4000 vUSDC
            await positionTracker.updatePosition(
                trader1.address,
                ethers.utils.parseEther("2"),
                ethers.utils.parseEther("-4000")
            );
            
            // Reduce long position: -1 vETH, +2000 vUSDC
            await positionTracker.updatePosition(
                trader1.address,
                ethers.utils.parseEther("-1"),
                ethers.utils.parseEther("2000")
            );
            
            const result = await getPositionFromTx(trader1.address);
            expect(result.baseBalance).to.equal(ethers.utils.parseEther("1"));
            expect(result.quoteBalance).to.equal(ethers.utils.parseEther("-2000"));
            expect(result.realizedPnl).to.equal(0);
        });
        
        it("Should close position completely", async function () {
            // Open long position: +1 vETH, -2000 vUSDC
            await positionTracker.updatePosition(
                trader1.address,
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("-2000")
            );
            
            // Close position: -1 vETH, +2000 vUSDC
            await positionTracker.updatePosition(
                trader1.address,
                ethers.utils.parseEther("-1"),
                ethers.utils.parseEther("2000")
            );
            
            const result = await getPositionFromTx(trader1.address);
            expect(result.baseBalance).to.equal(0);
            expect(result.quoteBalance).to.equal(0);
            expect(result.realizedPnl).to.equal(0);
        });
        
        it("Should flip position from long to short", async function () {
            // Open long position: +1 vETH, -2000 vUSDC
            await positionTracker.updatePosition(
                trader1.address,
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("-2000")
            );
            
            // Close long and open short: -2 vETH, +4100 vUSDC (profit on first ETH)
            await positionTracker.updatePosition(
                trader1.address,
                ethers.utils.parseEther("-2"),
                ethers.utils.parseEther("4100")
            );
            
            const result = await getPositionFromTx(trader1.address);
            expect(result.baseBalance).to.equal(ethers.utils.parseEther("-1"));
            expect(result.quoteBalance).to.equal(ethers.utils.parseEther("2100"));
            expect(result.realizedPnl).to.equal(0); // PnL is realized separately
        });
        
        it("Should handle multiple independent traders", async function () {
            // Trader 1: Long 1 vETH
            await positionTracker.updatePosition(
                trader1.address,
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("-2000")
            );
            
            // Trader 2: Short 2 vETH
            await positionTracker.updatePosition(
                trader2.address,
                ethers.utils.parseEther("-2"),
                ethers.utils.parseEther("4000")
            );
            
            // Trader 3: Long 0.5 vETH
            await positionTracker.updatePosition(
                trader3.address,
                ethers.utils.parseEther("0.5"),
                ethers.utils.parseEther("-1000")
            );
            
            const result1 = await getPositionFromTx(trader1.address);
            const result2 = await getPositionFromTx(trader2.address);
            const result3 = await getPositionFromTx(trader3.address);
            
            expect(result1.baseBalance).to.equal(ethers.utils.parseEther("1"));
            expect(result1.quoteBalance).to.equal(ethers.utils.parseEther("-2000"));
            
            expect(result2.baseBalance).to.equal(ethers.utils.parseEther("-2"));
            expect(result2.quoteBalance).to.equal(ethers.utils.parseEther("4000"));
            
            expect(result3.baseBalance).to.equal(ethers.utils.parseEther("0.5"));
            expect(result3.quoteBalance).to.equal(ethers.utils.parseEther("-1000"));
        });
        
        it("Should handle small decimal changes", async function () {
            // Open position with small amounts
            await positionTracker.updatePosition(
                trader1.address,
                ethers.utils.parseEther("0.001"),
                ethers.utils.parseEther("-2")
            );
            
            const result = await getPositionFromTx(trader1.address);
            expect(result.baseBalance).to.equal(ethers.utils.parseEther("0.001"));
            expect(result.quoteBalance).to.equal(ethers.utils.parseEther("-2"));
        });
    });
    
    describe("realizePnl", function () {
        it("Should record realized PnL for new trader", async function () {
            const pnlAmount = ethers.utils.parseEther("100"); // $100 profit
            
            await expect(
                positionTracker.realizePnl(trader1.address, pnlAmount)
            ).to.emit(positionTracker, "PnlRealized")
              .withArgs(trader1.address, pnlAmount, pnlAmount);
            
            const result = await getPositionFromTx(trader1.address);
            expect(result.realizedPnl).to.equal(pnlAmount);
        });
        
        it("Should accumulate realized PnL over multiple calls", async function () {
            // First profit
            await positionTracker.realizePnl(trader1.address, ethers.utils.parseEther("100"));
            
            // Second profit
            await positionTracker.realizePnl(trader1.address, ethers.utils.parseEther("50"));
            
            // Third profit
            await positionTracker.realizePnl(trader1.address, ethers.utils.parseEther("25"));
            
            const result = await getPositionFromTx(trader1.address);
            expect(result.realizedPnl).to.equal(ethers.utils.parseEther("175"));
        });
        
        it("Should handle negative PnL (losses)", async function () {
            const lossAmount = ethers.utils.parseEther("-200"); // $200 loss
            
            await positionTracker.realizePnl(trader1.address, lossAmount);
            
            const result = await getPositionFromTx(trader1.address);
            expect(result.realizedPnl).to.equal(lossAmount);
        });
        
        it("Should handle mixed profits and losses", async function () {
            // Profit
            await positionTracker.realizePnl(trader1.address, ethers.utils.parseEther("100"));
            
            // Loss
            await positionTracker.realizePnl(trader1.address, ethers.utils.parseEther("-50"));
            
            // Profit
            await positionTracker.realizePnl(trader1.address, ethers.utils.parseEther("30"));
            
            const result = await getPositionFromTx(trader1.address);
            expect(result.realizedPnl).to.equal(ethers.utils.parseEther("80")); // 100 - 50 + 30 = 80
        });
        
        it("Should not affect base/quote balances", async function () {
            // Set position
            await positionTracker.updatePosition(
                trader1.address,
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("-2000")
            );
            
            // Realize PnL
            await positionTracker.realizePnl(trader1.address, ethers.utils.parseEther("100"));
            
            const result = await getPositionFromTx(trader1.address);
            expect(result.baseBalance).to.equal(ethers.utils.parseEther("1"));
            expect(result.quoteBalance).to.equal(ethers.utils.parseEther("-2000"));
            expect(result.realizedPnl).to.equal(ethers.utils.parseEther("100"));
        });
    });
    
    describe("getPositionValue", function () {
        it("Should return 0 for trader with no position", async function () {
            const markPrice = ethers.utils.parseEther("2000"); // $2000/ETH
            const positionValue = await getPositionValueFromTx(trader1.address, markPrice);
            
            expect(positionValue).to.equal(0);
        });
        
        it("Should calculate value for long position at entry price (no P&L)", async function () {
            // Long 1 vETH at $2000
            await positionTracker.updatePosition(
                trader1.address,
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("-2000")
            );
            
            const markPrice = ethers.utils.parseEther("2000"); // Same as entry
            const positionValue = await getPositionValueFromTx(trader1.address, markPrice);
            
            // (1 ETH * 2000) / 1e18 + (-2000) = 2000 - 2000 = 0
            expect(positionValue).to.equal(0);
        });
        
        it("Should calculate profit for long position when price increases", async function () {
            // Long 1 vETH at $2000
            await positionTracker.updatePosition(
                trader1.address,
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("-2000")
            );
            
            const markPrice = ethers.utils.parseEther("2500"); // Price increased to $2500
            const positionValue = await getPositionValueFromTx(trader1.address, markPrice);
            
            // (1 ETH * 2500) / 1e18 + (-2000) = 2500 - 2000 = 500
            expect(positionValue).to.equal(ethers.utils.parseEther("500"));
        });
        
        it("Should calculate loss for long position when price decreases", async function () {
            // Long 1 vETH at $2000
            await positionTracker.updatePosition(
                trader1.address,
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("-2000")
            );
            
            const markPrice = ethers.utils.parseEther("1800"); // Price decreased to $1800
            const positionValue = await getPositionValueFromTx(trader1.address, markPrice);
            
            // (1 ETH * 1800) / 1e18 + (-2000) = 1800 - 2000 = -200
            expect(positionValue).to.equal(ethers.utils.parseEther("-200"));
        });
        
        it("Should calculate profit for short position when price decreases", async function () {
            // Short 1 vETH at $2000
            await positionTracker.updatePosition(
                trader1.address,
                ethers.utils.parseEther("-1"),
                ethers.utils.parseEther("2000")
            );
            
            const markPrice = ethers.utils.parseEther("1800"); // Price decreased to $1800
            const positionValue = await getPositionValueFromTx(trader1.address, markPrice);
            
            // (-1 ETH * 1800) / 1e18 + 2000 = -1800 + 2000 = 200
            expect(positionValue).to.equal(ethers.utils.parseEther("200"));
        });
        
        it("Should calculate loss for short position when price increases", async function () {
            // Short 1 vETH at $2000
            await positionTracker.updatePosition(
                trader1.address,
                ethers.utils.parseEther("-1"),
                ethers.utils.parseEther("2000")
            );
            
            const markPrice = ethers.utils.parseEther("2200"); // Price increased to $2200
            const positionValue = await getPositionValueFromTx(trader1.address, markPrice);
            
            // (-1 ETH * 2200) / 1e18 + 2000 = -2200 + 2000 = -200
            expect(positionValue).to.equal(ethers.utils.parseEther("-200"));
        });
        
        it("Should handle large position sizes", async function () {
            // Long 10 vETH at $2000
            await positionTracker.updatePosition(
                trader1.address,
                ethers.utils.parseEther("10"),
                ethers.utils.parseEther("-20000")
            );
            
            const markPrice = ethers.utils.parseEther("2500");
            const positionValue = await getPositionValueFromTx(trader1.address, markPrice);
            
            // (10 ETH * 2500) / 1e18 + (-20000) = 25000 - 20000 = 5000
            expect(positionValue).to.equal(ethers.utils.parseEther("5000"));
        });
        
        it("Should handle fractional position sizes", async function () {
            // Long 0.5 vETH at $2000
            await positionTracker.updatePosition(
                trader1.address,
                ethers.utils.parseEther("0.5"),
                ethers.utils.parseEther("-1000")
            );
            
            const markPrice = ethers.utils.parseEther("2200");
            const positionValue = await getPositionValueFromTx(trader1.address, markPrice);
            
            // (0.5 ETH * 2200) / 1e18 + (-1000) = 1100 - 1000 = 100
            expect(positionValue).to.equal(ethers.utils.parseEther("100"));
        });
    });
    
    describe("hasPosition", function () {
        it("Should return false for new trader", async function () {
            const hasPos = await hasPositionFromTx(trader1.address);
            expect(hasPos).to.be.false;
        });
        
        it("Should return true after opening position", async function () {
            await positionTracker.updatePosition(
                trader1.address,
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("-2000")
            );
            
            const hasPos = await hasPositionFromTx(trader1.address);
            expect(hasPos).to.be.true;
        });
        
        it("Should return false after closing position", async function () {
            // Open position
            await positionTracker.updatePosition(
                trader1.address,
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("-2000")
            );
            
            // Close position
            await positionTracker.updatePosition(
                trader1.address,
                ethers.utils.parseEther("-1"),
                ethers.utils.parseEther("2000")
            );
            
            const hasPos = await hasPositionFromTx(trader1.address);
            expect(hasPos).to.be.false;
        });
        
        it("Should return true if only baseBalance is non-zero", async function () {
            await positionTracker.updatePosition(
                trader1.address,
                ethers.utils.parseEther("1"),
                0
            );
            
            const hasPos = await hasPositionFromTx(trader1.address);
            expect(hasPos).to.be.true;
        });
        
        it("Should return true if only quoteBalance is non-zero", async function () {
            await positionTracker.updatePosition(
                trader1.address,
                0,
                ethers.utils.parseEther("1000")
            );
            
            const hasPos = await hasPositionFromTx(trader1.address);
            expect(hasPos).to.be.true;
        });
    });
    
    describe("Integration: Complex trading scenario", function () {
        it("Should handle full lifecycle: open, increase, decrease, close with PnL", async function () {
            // 1. Open long position: 1 vETH at $2000
            await positionTracker.updatePosition(
                trader1.address,
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("-2000")
            );
            
            let result = await getPositionFromTx(trader1.address);
            expect(result.baseBalance).to.equal(ethers.utils.parseEther("1"));
            expect(result.quoteBalance).to.equal(ethers.utils.parseEther("-2000"));
            expect(result.realizedPnl).to.equal(0);
            
            // 2. Increase position: +1 vETH at $2100
            await positionTracker.updatePosition(
                trader1.address,
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("-2100")
            );
            
            result = await getPositionFromTx(trader1.address);
            expect(result.baseBalance).to.equal(ethers.utils.parseEther("2"));
            expect(result.quoteBalance).to.equal(ethers.utils.parseEther("-4100"));
            
            // 3. Price moves to $2200, check unrealized P&L
            let markPrice = ethers.utils.parseEther("2200");
            let posValue = await getPositionValueFromTx(trader1.address, markPrice);
            // (2 * 2200) + (-4100) = 4400 - 4100 = 300
            expect(posValue).to.equal(ethers.utils.parseEther("300"));
            
            // 4. Partially close: sell 1 vETH at $2200
            await positionTracker.updatePosition(
                trader1.address,
                ethers.utils.parseEther("-1"),
                ethers.utils.parseEther("2200")
            );
            
            result = await getPositionFromTx(trader1.address);
            expect(result.baseBalance).to.equal(ethers.utils.parseEther("1"));
            expect(result.quoteBalance).to.equal(ethers.utils.parseEther("-1900"));
            
            // 5. Realize PnL from partial close
            // Sold 1 ETH at $2200, avg entry was $2050 (4100/2), profit = 150
            await positionTracker.realizePnl(trader1.address, ethers.utils.parseEther("150"));
            
            result = await getPositionFromTx(trader1.address);
            expect(result.realizedPnl).to.equal(ethers.utils.parseEther("150"));
            
            // 6. Close remaining position at $2300
            await positionTracker.updatePosition(
                trader1.address,
                ethers.utils.parseEther("-1"),
                ethers.utils.parseEther("2300")
            );
            
            result = await getPositionFromTx(trader1.address);
            expect(result.baseBalance).to.equal(0);
            expect(result.quoteBalance).to.equal(ethers.utils.parseEther("400")); // Leftover quote
            
            // 7. Realize final PnL
            await positionTracker.realizePnl(trader1.address, ethers.utils.parseEther("250"));
            
            result = await getPositionFromTx(trader1.address);
            expect(result.realizedPnl).to.equal(ethers.utils.parseEther("400")); // 150 + 250
        });
    });
});
