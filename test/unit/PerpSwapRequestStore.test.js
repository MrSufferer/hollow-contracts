const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PerpSwapRequestStore", function () {
    let store;
    let owner, user1, user2, user3;
    let vETH, vUSDC;

    beforeEach(async function () {
        [owner, user1, user2, user3] = await ethers.getSigners();

        // Deploy mock tokens for testing
        const Token = await ethers.getContractFactory("VirtualToken");
        vETH = await Token.deploy("Virtual ETH", "vETH");
        vUSDC = await Token.deploy("Virtual USDC", "vUSDC");
        await vETH.deployed();
        await vUSDC.deployed();

        // Deploy MockPerpSwapRequestStore for unit testing
        const Store = await ethers.getContractFactory("MockPerpSwapRequestStore");
        store = await Store.deploy();
        await store.deployed();
    });

    describe("Deployment", function () {
        it("Should deploy successfully", async function () {
            expect(store.address).to.be.properAddress;
        });

        it("Should start with zero requests", async function () {
            const count = await store.getRequestCount();
            expect(count).to.equal(0);
        });
    });

    describe("pushPerpRequest", function () {
        it("Should store a long position open request", async function () {
            const txhash = ethers.utils.formatBytes32String("tx1");
            const fee = 3000;
            const amountIn = ethers.utils.parseUnits("2000", 18); // 2000 vUSDC
            const amountOut = ethers.utils.parseEther("1"); // 1 vETH
            const sqrtPriceLimitX96 = 0;

            await store.pushPerpRequest(
                txhash,
                vUSDC.address,
                vETH.address,
                fee,
                user1.address,
                user1.address,
                amountIn,
                sqrtPriceLimitX96,
                amountOut,
                true,  // isOpenPosition
                true   // isLong
            );

            const req = await store.getPerpRequest(0);
            expect(req.txhash).to.equal(txhash);
            expect(req.tokenIn).to.equal(vUSDC.address);
            expect(req.tokenOut).to.equal(vETH.address);
            expect(req.fee).to.equal(fee);
            expect(req.sender).to.equal(user1.address);
            expect(req.recipient).to.equal(user1.address);
            expect(req.amountIn).to.equal(amountIn);
            expect(req.sqrtPriceLimitX96).to.equal(sqrtPriceLimitX96);
            expect(req.amountOut).to.equal(amountOut);
            expect(req.isOpenPosition).to.equal(true);
            expect(req.isLong).to.equal(true);
        });

        it("Should store a short position open request", async function () {
            const txhash = ethers.utils.formatBytes32String("tx2");
            const fee = 3000;
            const amountIn = ethers.utils.parseEther("1"); // 1 vETH
            const amountOut = ethers.utils.parseUnits("2000", 18); // 2000 vUSDC
            const sqrtPriceLimitX96 = 0;

            await store.pushPerpRequest(
                txhash,
                vETH.address,
                vUSDC.address,
                fee,
                user1.address,
                user1.address,
                amountIn,
                sqrtPriceLimitX96,
                amountOut,
                true,   // isOpenPosition
                false   // isLong (short)
            );

            const req = await store.getPerpRequest(0);
            expect(req.isOpenPosition).to.equal(true);
            expect(req.isLong).to.equal(false);
        });

        it("Should store a long position close request", async function () {
            const txhash = ethers.utils.formatBytes32String("tx3");
            const fee = 3000;
            const amountIn = ethers.utils.parseEther("1"); // 1 vETH (closing long)
            const amountOut = ethers.utils.parseUnits("2000", 18); // 2000 vUSDC
            const sqrtPriceLimitX96 = 0;

            await store.pushPerpRequest(
                txhash,
                vETH.address,
                vUSDC.address,
                fee,
                user1.address,
                user1.address,
                amountIn,
                sqrtPriceLimitX96,
                amountOut,
                false,  // isOpenPosition (closing)
                true    // isLong (closing long position)
            );

            const req = await store.getPerpRequest(0);
            expect(req.isOpenPosition).to.equal(false);
            expect(req.isLong).to.equal(true);
        });

        it("Should store a short position close request", async function () {
            const txhash = ethers.utils.formatBytes32String("tx4");
            const fee = 3000;
            const amountIn = ethers.utils.parseUnits("2000", 18); // 2000 vUSDC (buying back)
            const amountOut = ethers.utils.parseEther("1"); // 1 vETH
            const sqrtPriceLimitX96 = 0;

            await store.pushPerpRequest(
                txhash,
                vUSDC.address,
                vETH.address,
                fee,
                user1.address,
                user1.address,
                amountIn,
                sqrtPriceLimitX96,
                amountOut,
                false,  // isOpenPosition (closing)
                false   // isLong (closing short position)
            );

            const req = await store.getPerpRequest(0);
            expect(req.isOpenPosition).to.equal(false);
            expect(req.isLong).to.equal(false);
        });

        it("Should store multiple requests correctly", async function () {
            const requests = [
                { isOpen: true, isLong: true },
                { isOpen: true, isLong: false },
                { isOpen: false, isLong: true },
                { isOpen: false, isLong: false }
            ];

            for (let i = 0; i < requests.length; i++) {
                const txhash = ethers.utils.formatBytes32String(`tx${i}`);
                await store.pushPerpRequest(
                    txhash,
                    vUSDC.address,
                    vETH.address,
                    3000,
                    user1.address,
                    user1.address,
                    ethers.utils.parseUnits("1000", 18),
                    0,
                    ethers.utils.parseEther("0.5"),
                    requests[i].isOpen,
                    requests[i].isLong
                );
            }

            const count = await store.getRequestCount();
            expect(count).to.equal(4);

            // Verify each request
            for (let i = 0; i < requests.length; i++) {
                const req = await store.getPerpRequest(i);
                expect(req.isOpenPosition).to.equal(requests[i].isOpen);
                expect(req.isLong).to.equal(requests[i].isLong);
            }
        });

        it("Should handle different amounts correctly", async function () {
            const amounts = [
                ethers.utils.parseUnits("100", 18),
                ethers.utils.parseUnits("1000", 18),
                ethers.utils.parseUnits("10000", 18)
            ];

            for (let i = 0; i < amounts.length; i++) {
                const txhash = ethers.utils.formatBytes32String(`tx${i}`);
                await store.pushPerpRequest(
                    txhash,
                    vUSDC.address,
                    vETH.address,
                    3000,
                    user1.address,
                    user1.address,
                    amounts[i],
                    0,
                    amounts[i].div(2),
                    true,
                    true
                );
            }

            for (let i = 0; i < amounts.length; i++) {
                const req = await store.getPerpRequest(i);
                expect(req.amountIn).to.equal(amounts[i]);
            }
        });

        it("Should handle different fee tiers", async function () {
            const fees = [500, 3000, 10000];

            for (let i = 0; i < fees.length; i++) {
                const txhash = ethers.utils.formatBytes32String(`tx${i}`);
                await store.pushPerpRequest(
                    txhash,
                    vUSDC.address,
                    vETH.address,
                    fees[i],
                    user1.address,
                    user1.address,
                    ethers.utils.parseUnits("1000", 18),
                    0,
                    ethers.utils.parseEther("0.5"),
                    true,
                    true
                );
            }

            for (let i = 0; i < fees.length; i++) {
                const req = await store.getPerpRequest(i);
                expect(req.fee).to.equal(fees[i]);
            }
        });

        it("Should handle different senders and recipients", async function () {
            const users = [user1, user2, user3];

            for (let i = 0; i < users.length; i++) {
                const txhash = ethers.utils.formatBytes32String(`tx${i}`);
                await store.pushPerpRequest(
                    txhash,
                    vUSDC.address,
                    vETH.address,
                    3000,
                    users[i].address,
                    users[i].address,
                    ethers.utils.parseUnits("1000", 18),
                    0,
                    ethers.utils.parseEther("0.5"),
                    true,
                    true
                );
            }

            for (let i = 0; i < users.length; i++) {
                const req = await store.getPerpRequest(i);
                expect(req.sender).to.equal(users[i].address);
                expect(req.recipient).to.equal(users[i].address);
            }
        });

        it("Should handle price limits", async function () {
            const priceLimits = [
                ethers.BigNumber.from("1461446703485210103287273052203988822378723970341"),
                ethers.BigNumber.from("79228162514264337593543950336"), // Valid uint160
                ethers.BigNumber.from("0")
            ];

            for (let i = 0; i < priceLimits.length; i++) {
                const txhash = ethers.utils.formatBytes32String(`tx${i}`);
                await store.pushPerpRequest(
                    txhash,
                    vUSDC.address,
                    vETH.address,
                    3000,
                    user1.address,
                    user1.address,
                    ethers.utils.parseUnits("1000", 18),
                    priceLimits[i],
                    ethers.utils.parseEther("0.5"),
                    true,
                    true
                );
            }

            for (let i = 0; i < priceLimits.length; i++) {
                const req = await store.getPerpRequest(i);
                expect(req.sqrtPriceLimitX96).to.equal(priceLimits[i]);
            }
        });
    });

    describe("getPerpRequest", function () {
        beforeEach(async function () {
            // Push a test request
            const txhash = ethers.utils.formatBytes32String("test");
            await store.pushPerpRequest(
                txhash,
                vUSDC.address,
                vETH.address,
                3000,
                user1.address,
                user1.address,
                ethers.utils.parseUnits("2000", 18),
                0,
                ethers.utils.parseEther("1"),
                true,
                true
            );
        });

        it("Should retrieve stored request correctly", async function () {
            const req = await store.getPerpRequest(0);
            expect(req.tokenIn).to.equal(vUSDC.address);
            expect(req.tokenOut).to.equal(vETH.address);
            expect(req.isOpenPosition).to.equal(true);
            expect(req.isLong).to.equal(true);
        });

        it("Should revert for out of bounds index", async function () {
            await expect(store.getPerpRequest(99)).to.be.revertedWith("Index out of bounds");
        });
    });

    describe("getPerpRequestDetailed", function () {
        beforeEach(async function () {
            const txhash = ethers.utils.formatBytes32String("detailed");
            await store.pushPerpRequest(
                txhash,
                vUSDC.address,
                vETH.address,
                3000,
                user1.address,
                user1.address,
                ethers.utils.parseUnits("2000", 18),
                0,
                ethers.utils.parseEther("1"),
                true,
                true
            );
        });

        it("Should return all fields correctly", async function () {
            const [
                txhash,
                tokenIn,
                tokenOut,
                fee,
                sender,
                recipient,
                amountIn,
                sqrtPriceLimitX96,
                amountOut,
                isOpenPosition,
                isLong
            ] = await store.getPerpRequestDetailed(0);

            expect(txhash).to.equal(ethers.utils.formatBytes32String("detailed"));
            expect(tokenIn).to.equal(vUSDC.address);
            expect(tokenOut).to.equal(vETH.address);
            expect(fee).to.equal(3000);
            expect(sender).to.equal(user1.address);
            expect(recipient).to.equal(user1.address);
            expect(amountIn).to.equal(ethers.utils.parseUnits("2000", 18));
            expect(sqrtPriceLimitX96).to.equal(0);
            expect(amountOut).to.equal(ethers.utils.parseEther("1"));
            expect(isOpenPosition).to.equal(true);
            expect(isLong).to.equal(true);
        });
    });

    describe("updatePerpRequest", function () {
        beforeEach(async function () {
            const txhash = ethers.utils.formatBytes32String("update");
            await store.pushPerpRequest(
                txhash,
                vUSDC.address,
                vETH.address,
                3000,
                user1.address,
                user1.address,
                ethers.utils.parseUnits("2000", 18),
                0,
                ethers.utils.parseEther("1"),
                true,
                true
            );
        });

        it("Should update amountIn correctly", async function () {
            const newAmount = ethers.utils.parseUnits("3000", 18);
            await store.updatePerpRequest(0, newAmount);

            const req = await store.getPerpRequest(0);
            expect(req.amountIn).to.equal(newAmount);
        });

        it("Should preserve other fields when updating", async function () {
            const newAmount = ethers.utils.parseUnits("3000", 18);
            await store.updatePerpRequest(0, newAmount);

            const req = await store.getPerpRequest(0);
            expect(req.tokenIn).to.equal(vUSDC.address);
            expect(req.tokenOut).to.equal(vETH.address);
            expect(req.isOpenPosition).to.equal(true);
            expect(req.isLong).to.equal(true);
            expect(req.sender).to.equal(user1.address);
        });

        it("Should revert for out of bounds index", async function () {
            await expect(store.updatePerpRequest(99, 1000)).to.be.revertedWith("Index out of bounds");
        });
    });

    describe("Concurrent Request Scenarios", function () {
        it("Should handle multiple users opening positions concurrently", async function () {
            const users = [user1, user2, user3];
            const txs = [];

            // Simulate concurrent position openings
            for (let i = 0; i < users.length; i++) {
                const txhash = ethers.utils.formatBytes32String(`concurrent${i}`);
                txs.push(
                    store.pushPerpRequest(
                        txhash,
                        vUSDC.address,
                        vETH.address,
                        3000,
                        users[i].address,
                        users[i].address,
                        ethers.utils.parseUnits("1000", 18),
                        0,
                        ethers.utils.parseEther("0.5"),
                        true,
                        i % 2 === 0 // Alternate long/short
                    )
                );
            }

            await Promise.all(txs);

            const count = await store.getRequestCount();
            expect(count).to.equal(3);

            // Verify all requests stored correctly
            for (let i = 0; i < users.length; i++) {
                const req = await store.getPerpRequest(i);
                expect(req.sender).to.equal(users[i].address);
            }
        });

        it("Should handle mixed open and close requests", async function () {
            const scenarios = [
                { user: user1, isOpen: true, isLong: true },
                { user: user2, isOpen: true, isLong: false },
                { user: user1, isOpen: false, isLong: true },
                { user: user2, isOpen: false, isLong: false }
            ];

            for (let i = 0; i < scenarios.length; i++) {
                const txhash = ethers.utils.formatBytes32String(`mixed${i}`);
                await store.pushPerpRequest(
                    txhash,
                    vUSDC.address,
                    vETH.address,
                    3000,
                    scenarios[i].user.address,
                    scenarios[i].user.address,
                    ethers.utils.parseUnits("1000", 18),
                    0,
                    ethers.utils.parseEther("0.5"),
                    scenarios[i].isOpen,
                    scenarios[i].isLong
                );
            }

            const count = await store.getRequestCount();
            expect(count).to.equal(4);

            // Verify pattern
            for (let i = 0; i < scenarios.length; i++) {
                const req = await store.getPerpRequest(i);
                expect(req.isOpenPosition).to.equal(scenarios[i].isOpen);
                expect(req.isLong).to.equal(scenarios[i].isLong);
            }
        });
    });

    describe("Edge Cases", function () {
        it("Should handle zero amounts", async function () {
            const txhash = ethers.utils.formatBytes32String("zero");
            await store.pushPerpRequest(
                txhash,
                vUSDC.address,
                vETH.address,
                3000,
                user1.address,
                user1.address,
                0,
                0,
                0,
                true,
                true
            );

            const req = await store.getPerpRequest(0);
            expect(req.amountIn).to.equal(0);
            expect(req.amountOut).to.equal(0);
        });

        it("Should handle very large amounts", async function () {
            const largeAmount = ethers.constants.MaxUint256.div(2);
            const txhash = ethers.utils.formatBytes32String("large");
            
            await store.pushPerpRequest(
                txhash,
                vUSDC.address,
                vETH.address,
                3000,
                user1.address,
                user1.address,
                largeAmount,
                0,
                largeAmount.div(2),
                true,
                true
            );

            const req = await store.getPerpRequest(0);
            expect(req.amountIn).to.equal(largeAmount);
        });

        it("Should handle different sender and recipient", async function () {
            const txhash = ethers.utils.formatBytes32String("different");
            await store.pushPerpRequest(
                txhash,
                vUSDC.address,
                vETH.address,
                3000,
                user1.address,
                user2.address, // Different recipient
                ethers.utils.parseUnits("1000", 18),
                0,
                ethers.utils.parseEther("0.5"),
                true,
                true
            );

            const req = await store.getPerpRequest(0);
            expect(req.sender).to.equal(user1.address);
            expect(req.recipient).to.equal(user2.address);
        });
    });

    describe("Helper Functions", function () {
        it("Should return correct request count", async function () {
            expect(await store.getRequestCount()).to.equal(0);

            for (let i = 0; i < 5; i++) {
                const txhash = ethers.utils.formatBytes32String(`count${i}`);
                await store.pushPerpRequest(
                    txhash,
                    vUSDC.address,
                    vETH.address,
                    3000,
                    user1.address,
                    user1.address,
                    ethers.utils.parseUnits("1000", 18),
                    0,
                    ethers.utils.parseEther("0.5"),
                    true,
                    true
                );
                expect(await store.getRequestCount()).to.equal(i + 1);
            }
        });

        it("Should clear all requests", async function () {
            // Add some requests
            for (let i = 0; i < 3; i++) {
                const txhash = ethers.utils.formatBytes32String(`clear${i}`);
                await store.pushPerpRequest(
                    txhash,
                    vUSDC.address,
                    vETH.address,
                    3000,
                    user1.address,
                    user1.address,
                    ethers.utils.parseUnits("1000", 18),
                    0,
                    ethers.utils.parseEther("0.5"),
                    true,
                    true
                );
            }

            expect(await store.getRequestCount()).to.equal(3);

            await store.clear();

            expect(await store.getRequestCount()).to.equal(0);
        });
    });
});
