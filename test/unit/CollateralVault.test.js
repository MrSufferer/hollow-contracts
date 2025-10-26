const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CollateralVault", function () {
    let collateralVault;
    let usdc;
    let owner;
    let clearingHouse;
    let trader1;
    let trader2;
    let nonAuthorized;

    const INITIAL_USDC_SUPPLY = ethers.utils.parseUnits("1000000", 18); // 1M USDC (using 18 decimals for testing)
    const DEPOSIT_AMOUNT = ethers.utils.parseUnits("1000", 18); // 1000 USDC
    const WITHDRAW_AMOUNT = ethers.utils.parseUnits("500", 18); // 500 USDC

    beforeEach(async function () {
        [owner, clearingHouse, trader1, trader2, nonAuthorized] = await ethers.getSigners();

        // Deploy mock USDC token
        const MockUSDC = await ethers.getContractFactory("MockUSDC");
        usdc = await MockUSDC.deploy();
        await usdc.deployed();

        // Mint USDC to traders
        await usdc.mint(trader1.address, INITIAL_USDC_SUPPLY);
        await usdc.mint(trader2.address, INITIAL_USDC_SUPPLY);

        // Deploy CollateralVault
        const CollateralVault = await ethers.getContractFactory("CollateralVault");
        collateralVault = await CollateralVault.deploy(usdc.address);
        await collateralVault.deployed();

        // Set clearing house
        await collateralVault.setClearingHouse(clearingHouse.address);
    });

    describe("Deployment", function () {
        it("Should set the correct USDC token address", async function () {
            expect(await collateralVault.USDC()).to.equal(usdc.address);
        });

        it("Should set the clearing house address", async function () {
            expect(await collateralVault.clearingHouse()).to.equal(clearingHouse.address);
        });

        it("Should revert when deploying with zero address", async function () {
            const CollateralVault = await ethers.getContractFactory("CollateralVault");
            await expect(
                CollateralVault.deploy(ethers.constants.AddressZero)
            ).to.be.revertedWith("CollateralVault: Zero address");
        });

        it("Should emit ClearingHouseSet event when setting clearing house", async function () {
            const CollateralVault = await ethers.getContractFactory("CollateralVault");
            const newVault = await CollateralVault.deploy(usdc.address);
            await newVault.deployed();

            await expect(newVault.setClearingHouse(clearingHouse.address))
                .to.emit(newVault, "ClearingHouseSet")
                .withArgs(clearingHouse.address);
        });
    });

    describe("setClearingHouse", function () {
        it("Should revert when setting clearing house twice", async function () {
            await expect(
                collateralVault.setClearingHouse(trader1.address)
            ).to.be.revertedWith("CollateralVault: Already set");
        });

        it("Should revert when setting clearing house to zero address", async function () {
            const CollateralVault = await ethers.getContractFactory("CollateralVault");
            const newVault = await CollateralVault.deploy(usdc.address);
            await newVault.deployed();

            await expect(
                newVault.setClearingHouse(ethers.constants.AddressZero)
            ).to.be.revertedWith("CollateralVault: Zero address");
        });
    });

    describe("deposit", function () {
        beforeEach(async function () {
            // Approve vault to spend trader's USDC
            await usdc.connect(trader1).approve(collateralVault.address, DEPOSIT_AMOUNT);
        });

        it("Should deposit USDC successfully", async function () {
            const initialBalance = await usdc.balanceOf(trader1.address);
            const initialVaultBalance = await usdc.balanceOf(collateralVault.address);

            await collateralVault.connect(clearingHouse).deposit(trader1.address, DEPOSIT_AMOUNT);

            expect(await collateralVault.balances(trader1.address)).to.equal(DEPOSIT_AMOUNT);
            expect(await usdc.balanceOf(trader1.address)).to.equal(initialBalance.sub(DEPOSIT_AMOUNT));
            expect(await usdc.balanceOf(collateralVault.address)).to.equal(
                initialVaultBalance.add(DEPOSIT_AMOUNT)
            );
        });

        it("Should update balance correctly on multiple deposits", async function () {
            await usdc.connect(trader1).approve(collateralVault.address, DEPOSIT_AMOUNT.mul(2));

            await collateralVault.connect(clearingHouse).deposit(trader1.address, DEPOSIT_AMOUNT);
            await collateralVault.connect(clearingHouse).deposit(trader1.address, DEPOSIT_AMOUNT);

            expect(await collateralVault.balances(trader1.address)).to.equal(DEPOSIT_AMOUNT.mul(2));
        });

        it("Should emit Deposited event", async function () {
            await expect(
                collateralVault.connect(clearingHouse).deposit(trader1.address, DEPOSIT_AMOUNT)
            )
                .to.emit(collateralVault, "Deposited")
                .withArgs(trader1.address, DEPOSIT_AMOUNT);
        });

        it("Should revert when called by non-clearing house", async function () {
            await expect(
                collateralVault.connect(nonAuthorized).deposit(trader1.address, DEPOSIT_AMOUNT)
            ).to.be.revertedWith("CollateralVault: Only clearing house");
        });

        it("Should revert when depositing zero amount", async function () {
            await expect(
                collateralVault.connect(clearingHouse).deposit(trader1.address, 0)
            ).to.be.revertedWith("CollateralVault: Zero amount");
        });

        it("Should revert when trader address is zero", async function () {
            await expect(
                collateralVault.connect(clearingHouse).deposit(ethers.constants.AddressZero, DEPOSIT_AMOUNT)
            ).to.be.revertedWith("CollateralVault: Zero address");
        });

        it("Should revert when trader has insufficient USDC", async function () {
            const excessiveAmount = INITIAL_USDC_SUPPLY.add(1);
            await usdc.connect(trader1).approve(collateralVault.address, excessiveAmount);

            await expect(
                collateralVault.connect(clearingHouse).deposit(trader1.address, excessiveAmount)
            ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
        });

        it("Should revert when trader has not approved vault", async function () {
            await usdc.connect(trader2).approve(collateralVault.address, 0);

            await expect(
                collateralVault.connect(clearingHouse).deposit(trader2.address, DEPOSIT_AMOUNT)
            ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");
        });
    });

    describe("withdraw", function () {
        beforeEach(async function () {
            // Deposit first
            await usdc.connect(trader1).approve(collateralVault.address, DEPOSIT_AMOUNT);
            await collateralVault.connect(clearingHouse).deposit(trader1.address, DEPOSIT_AMOUNT);
        });

        it("Should withdraw USDC successfully", async function () {
            const initialBalance = await usdc.balanceOf(trader1.address);
            const initialVaultBalance = await collateralVault.balances(trader1.address);

            await collateralVault.connect(clearingHouse).withdraw(trader1.address, WITHDRAW_AMOUNT);

            expect(await collateralVault.balances(trader1.address)).to.equal(
                initialVaultBalance.sub(WITHDRAW_AMOUNT)
            );
            expect(await usdc.balanceOf(trader1.address)).to.equal(initialBalance.add(WITHDRAW_AMOUNT));
        });

        it("Should allow withdrawing entire balance", async function () {
            await collateralVault.connect(clearingHouse).withdraw(trader1.address, DEPOSIT_AMOUNT);

            expect(await collateralVault.balances(trader1.address)).to.equal(0);
        });

        it("Should update balance correctly on multiple withdrawals", async function () {
            await collateralVault.connect(clearingHouse).withdraw(trader1.address, WITHDRAW_AMOUNT);
            await collateralVault.connect(clearingHouse).withdraw(trader1.address, WITHDRAW_AMOUNT);

            expect(await collateralVault.balances(trader1.address)).to.equal(0);
        });

        it("Should emit Withdrawn event", async function () {
            await expect(
                collateralVault.connect(clearingHouse).withdraw(trader1.address, WITHDRAW_AMOUNT)
            )
                .to.emit(collateralVault, "Withdrawn")
                .withArgs(trader1.address, WITHDRAW_AMOUNT);
        });

        it("Should revert when called by non-clearing house", async function () {
            await expect(
                collateralVault.connect(nonAuthorized).withdraw(trader1.address, WITHDRAW_AMOUNT)
            ).to.be.revertedWith("CollateralVault: Only clearing house");
        });

        it("Should revert when withdrawing zero amount", async function () {
            await expect(
                collateralVault.connect(clearingHouse).withdraw(trader1.address, 0)
            ).to.be.revertedWith("CollateralVault: Zero amount");
        });

        it("Should revert when trader address is zero", async function () {
            await expect(
                collateralVault.connect(clearingHouse).withdraw(ethers.constants.AddressZero, WITHDRAW_AMOUNT)
            ).to.be.revertedWith("CollateralVault: Zero address");
        });

        it("Should revert when withdrawing more than balance", async function () {
            const excessiveAmount = DEPOSIT_AMOUNT.add(1);

            await expect(
                collateralVault.connect(clearingHouse).withdraw(trader1.address, excessiveAmount)
            ).to.be.revertedWith("CollateralVault: Insufficient balance");
        });

        it("Should revert when withdrawing from zero balance", async function () {
            await expect(
                collateralVault.connect(clearingHouse).withdraw(trader2.address, WITHDRAW_AMOUNT)
            ).to.be.revertedWith("CollateralVault: Insufficient balance");
        });
    });

    describe("getBalance", function () {
        it("Should return zero balance initially", async function () {
            expect(await collateralVault.getBalance(trader1.address)).to.equal(0);
        });

        it("Should return correct balance after deposit", async function () {
            await usdc.connect(trader1).approve(collateralVault.address, DEPOSIT_AMOUNT);
            await collateralVault.connect(clearingHouse).deposit(trader1.address, DEPOSIT_AMOUNT);

            expect(await collateralVault.getBalance(trader1.address)).to.equal(DEPOSIT_AMOUNT);
        });

        it("Should return correct balance after withdrawal", async function () {
            await usdc.connect(trader1).approve(collateralVault.address, DEPOSIT_AMOUNT);
            await collateralVault.connect(clearingHouse).deposit(trader1.address, DEPOSIT_AMOUNT);
            await collateralVault.connect(clearingHouse).withdraw(trader1.address, WITHDRAW_AMOUNT);

            expect(await collateralVault.getBalance(trader1.address)).to.equal(WITHDRAW_AMOUNT);
        });

        it("Should track balances independently for multiple traders", async function () {
            const trader1Amount = ethers.utils.parseUnits("1000", 18);
            const trader2Amount = ethers.utils.parseUnits("2000", 18);

            await usdc.connect(trader1).approve(collateralVault.address, trader1Amount);
            await usdc.connect(trader2).approve(collateralVault.address, trader2Amount);

            await collateralVault.connect(clearingHouse).deposit(trader1.address, trader1Amount);
            await collateralVault.connect(clearingHouse).deposit(trader2.address, trader2Amount);

            expect(await collateralVault.getBalance(trader1.address)).to.equal(trader1Amount);
            expect(await collateralVault.getBalance(trader2.address)).to.equal(trader2Amount);
        });
    });

    describe("Integration scenarios", function () {
        it("Should handle deposit -> withdraw -> deposit cycle", async function () {
            const amount1 = ethers.utils.parseUnits("1000", 18);
            const amount2 = ethers.utils.parseUnits("500", 18);
            const amount3 = ethers.utils.parseUnits("300", 18);

            await usdc.connect(trader1).approve(collateralVault.address, amount1.add(amount3));

            // Deposit
            await collateralVault.connect(clearingHouse).deposit(trader1.address, amount1);
            expect(await collateralVault.getBalance(trader1.address)).to.equal(amount1);

            // Withdraw
            await collateralVault.connect(clearingHouse).withdraw(trader1.address, amount2);
            expect(await collateralVault.getBalance(trader1.address)).to.equal(amount1.sub(amount2));

            // Deposit again
            await collateralVault.connect(clearingHouse).deposit(trader1.address, amount3);
            expect(await collateralVault.getBalance(trader1.address)).to.equal(
                amount1.sub(amount2).add(amount3)
            );
        });

        it("Should maintain vault solvency across multiple traders", async function () {
            const trader1Deposit = ethers.utils.parseUnits("1000", 18);
            const trader2Deposit = ethers.utils.parseUnits("2000", 18);

            await usdc.connect(trader1).approve(collateralVault.address, trader1Deposit);
            await usdc.connect(trader2).approve(collateralVault.address, trader2Deposit);

            await collateralVault.connect(clearingHouse).deposit(trader1.address, trader1Deposit);
            await collateralVault.connect(clearingHouse).deposit(trader2.address, trader2Deposit);

            const totalVaultBalance = await usdc.balanceOf(collateralVault.address);
            expect(totalVaultBalance).to.equal(trader1Deposit.add(trader2Deposit));

            await collateralVault.connect(clearingHouse).withdraw(trader1.address, trader1Deposit);
            await collateralVault.connect(clearingHouse).withdraw(trader2.address, trader2Deposit);

            expect(await usdc.balanceOf(collateralVault.address)).to.equal(0);
        });
    });
});
