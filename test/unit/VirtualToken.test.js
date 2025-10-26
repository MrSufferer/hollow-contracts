const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("VirtualToken", function () {
    let VirtualToken;
    let vToken;
    let owner;
    let whitelistedAddress;
    let user1;
    let user2;

    beforeEach(async function () {
        // Get signers
        [owner, whitelistedAddress, user1, user2] = await ethers.getSigners();

        // Deploy VirtualToken
        VirtualToken = await ethers.getContractFactory("VirtualToken");
        vToken = await VirtualToken.deploy("Virtual ETH", "vETH");
        await vToken.deployed();
    });

    describe("Deployment", function () {
        it("Should set the correct name and symbol", async function () {
            expect(await vToken.name()).to.equal("Virtual ETH");
            expect(await vToken.symbol()).to.equal("vETH");
        });

        it("Should have zero initial supply", async function () {
            const totalSupply = await vToken.totalSupply();
            expect(totalSupply).to.equal(0);
        });

        it("Should set the correct owner", async function () {
            expect(await vToken.owner()).to.equal(owner.address);
        });

        it("Should have 18 decimals by default", async function () {
            expect(await vToken.decimals()).to.equal(18);
        });
    });

    describe("Whitelist Management", function () {
        describe("addToWhitelist", function () {
            it("Should allow owner to whitelist an address", async function () {
                await vToken.addToWhitelist(whitelistedAddress.address);
                expect(await vToken.isWhitelisted(whitelistedAddress.address)).to.be.true;
            });

            it("Should emit WhitelistAdded event", async function () {
                await expect(vToken.addToWhitelist(whitelistedAddress.address))
                    .to.emit(vToken, "WhitelistAdded")
                    .withArgs(whitelistedAddress.address);
            });

            it("Should revert if non-owner tries to whitelist", async function () {
                await expect(
                    vToken.connect(user1).addToWhitelist(user2.address)
                ).to.be.revertedWith("Ownable: caller is not the owner");
            });

            it("Should revert if trying to whitelist zero address", async function () {
                await expect(
                    vToken.addToWhitelist(ethers.constants.AddressZero)
                ).to.be.revertedWith("VirtualToken: zero address");
            });

            it("Should revert if address is already whitelisted", async function () {
                await vToken.addToWhitelist(whitelistedAddress.address);
                await expect(
                    vToken.addToWhitelist(whitelistedAddress.address)
                ).to.be.revertedWith("VirtualToken: already whitelisted");
            });
        });

        describe("removeFromWhitelist", function () {
            beforeEach(async function () {
                await vToken.addToWhitelist(whitelistedAddress.address);
            });

            it("Should allow owner to remove from whitelist", async function () {
                await vToken.removeFromWhitelist(whitelistedAddress.address);
                expect(await vToken.isWhitelisted(whitelistedAddress.address)).to.be.false;
            });

            it("Should emit WhitelistRemoved event", async function () {
                await expect(vToken.removeFromWhitelist(whitelistedAddress.address))
                    .to.emit(vToken, "WhitelistRemoved")
                    .withArgs(whitelistedAddress.address);
            });

            it("Should revert if non-owner tries to remove from whitelist", async function () {
                await expect(
                    vToken.connect(user1).removeFromWhitelist(whitelistedAddress.address)
                ).to.be.revertedWith("Ownable: caller is not the owner");
            });

            it("Should revert if address is not whitelisted", async function () {
                await expect(
                    vToken.removeFromWhitelist(user1.address)
                ).to.be.revertedWith("VirtualToken: not whitelisted");
            });
        });

        describe("isWhitelisted", function () {
            it("Should return false for non-whitelisted address", async function () {
                expect(await vToken.isWhitelisted(user1.address)).to.be.false;
            });

            it("Should return true for whitelisted address", async function () {
                await vToken.addToWhitelist(whitelistedAddress.address);
                expect(await vToken.isWhitelisted(whitelistedAddress.address)).to.be.true;
            });
        });
    });

    describe("Minting", function () {
        beforeEach(async function () {
            await vToken.addToWhitelist(whitelistedAddress.address);
        });

        it("Should allow whitelisted address to mint tokens", async function () {
            const mintAmount = ethers.utils.parseEther("100");
            
            await vToken.connect(whitelistedAddress).mint(user1.address, mintAmount);
            
            expect(await vToken.balanceOf(user1.address)).to.equal(mintAmount);
        });

        it("Should increase total supply when minting", async function () {
            const initialSupply = await vToken.totalSupply();
            const mintAmount = ethers.utils.parseEther("100");
            
            await vToken.connect(whitelistedAddress).mint(user1.address, mintAmount);
            
            const finalSupply = await vToken.totalSupply();
            expect(finalSupply).to.equal(initialSupply.add(mintAmount));
        });

        it("Should revert if non-whitelisted address tries to mint", async function () {
            const mintAmount = ethers.utils.parseEther("100");
            
            await expect(
                vToken.connect(user1).mint(user2.address, mintAmount)
            ).to.be.revertedWith("VirtualToken: not whitelisted");
        });

        it("Should revert if trying to mint to zero address", async function () {
            const mintAmount = ethers.utils.parseEther("100");
            
            await expect(
                vToken.connect(whitelistedAddress).mint(ethers.constants.AddressZero, mintAmount)
            ).to.be.revertedWith("VirtualToken: mint to zero address");
        });

        it("Should allow minting zero amount", async function () {
            await expect(
                vToken.connect(whitelistedAddress).mint(user1.address, 0)
            ).to.not.be.reverted;
        });

        it("Should allow multiple mints", async function () {
            const mintAmount1 = ethers.utils.parseEther("50");
            const mintAmount2 = ethers.utils.parseEther("30");
            
            await vToken.connect(whitelistedAddress).mint(user1.address, mintAmount1);
            await vToken.connect(whitelistedAddress).mint(user1.address, mintAmount2);
            
            expect(await vToken.balanceOf(user1.address)).to.equal(mintAmount1.add(mintAmount2));
        });
    });

    describe("Burning", function () {
        const initialMint = ethers.utils.parseEther("1000");

        beforeEach(async function () {
            await vToken.addToWhitelist(whitelistedAddress.address);
            await vToken.connect(whitelistedAddress).mint(user1.address, initialMint);
        });

        it("Should allow whitelisted address to burn tokens", async function () {
            const burnAmount = ethers.utils.parseEther("100");
            
            await vToken.connect(whitelistedAddress).burn(user1.address, burnAmount);
            
            expect(await vToken.balanceOf(user1.address)).to.equal(initialMint.sub(burnAmount));
        });

        it("Should decrease total supply when burning", async function () {
            const initialSupply = await vToken.totalSupply();
            const burnAmount = ethers.utils.parseEther("100");
            
            await vToken.connect(whitelistedAddress).burn(user1.address, burnAmount);
            
            const finalSupply = await vToken.totalSupply();
            expect(finalSupply).to.equal(initialSupply.sub(burnAmount));
        });

        it("Should revert if non-whitelisted address tries to burn", async function () {
            const burnAmount = ethers.utils.parseEther("100");
            
            await expect(
                vToken.connect(user1).burn(user1.address, burnAmount)
            ).to.be.revertedWith("VirtualToken: not whitelisted");
        });

        it("Should revert if trying to burn from zero address", async function () {
            const burnAmount = ethers.utils.parseEther("100");
            
            await expect(
                vToken.connect(whitelistedAddress).burn(ethers.constants.AddressZero, burnAmount)
            ).to.be.revertedWith("VirtualToken: burn from zero address");
        });

        it("Should revert if trying to burn more than balance", async function () {
            const burnAmount = initialMint.add(1);
            
            await expect(
                vToken.connect(whitelistedAddress).burn(user1.address, burnAmount)
            ).to.be.revertedWith("ERC20: burn amount exceeds balance");
        });

        it("Should allow burning zero amount", async function () {
            await expect(
                vToken.connect(whitelistedAddress).burn(user1.address, 0)
            ).to.not.be.reverted;
        });

        it("Should allow multiple burns", async function () {
            const burnAmount1 = ethers.utils.parseEther("300");
            const burnAmount2 = ethers.utils.parseEther("200");
            
            await vToken.connect(whitelistedAddress).burn(user1.address, burnAmount1);
            await vToken.connect(whitelistedAddress).burn(user1.address, burnAmount2);
            
            expect(await vToken.balanceOf(user1.address)).to.equal(
                initialMint.sub(burnAmount1).sub(burnAmount2)
            );
        });

        it("Should allow burning entire balance", async function () {
            await vToken.connect(whitelistedAddress).burn(user1.address, initialMint);
            
            expect(await vToken.balanceOf(user1.address)).to.equal(0);
        });
    });

    describe("Standard ERC20 Functionality", function () {
        const transferAmount = ethers.utils.parseEther("100");

        beforeEach(async function () {
            await vToken.addToWhitelist(whitelistedAddress.address);
            await vToken.connect(whitelistedAddress).mint(user1.address, transferAmount.mul(10));
        });

        it("Should allow standard transfers", async function () {
            await vToken.connect(user1).transfer(user2.address, transferAmount);
            
            expect(await vToken.balanceOf(user2.address)).to.equal(transferAmount);
        });

        it("Should allow approve and transferFrom", async function () {
            await vToken.connect(user1).approve(user2.address, transferAmount);
            await vToken.connect(user2).transferFrom(user1.address, user2.address, transferAmount);
            
            expect(await vToken.balanceOf(user2.address)).to.equal(transferAmount);
        });

        it("Should track allowances correctly", async function () {
            await vToken.connect(user1).approve(user2.address, transferAmount);
            
            expect(await vToken.allowance(user1.address, user2.address)).to.equal(transferAmount);
        });
    });

    describe("Edge Cases", function () {
        it("Should handle mint and burn in same transaction", async function () {
            await vToken.addToWhitelist(whitelistedAddress.address);
            
            const mintAmount = ethers.utils.parseEther("100");
            await vToken.connect(whitelistedAddress).mint(user1.address, mintAmount);
            
            const burnAmount = ethers.utils.parseEther("50");
            await vToken.connect(whitelistedAddress).burn(user1.address, burnAmount);
            
            expect(await vToken.balanceOf(user1.address)).to.equal(mintAmount.sub(burnAmount));
        });

        it("Should handle multiple whitelisted addresses", async function () {
            await vToken.addToWhitelist(whitelistedAddress.address);
            await vToken.addToWhitelist(user2.address);
            
            const mintAmount = ethers.utils.parseEther("100");
            
            // Both should be able to mint
            await vToken.connect(whitelistedAddress).mint(user1.address, mintAmount);
            await vToken.connect(user2).mint(user1.address, mintAmount);
            
            expect(await vToken.balanceOf(user1.address)).to.equal(mintAmount.mul(2));
        });

        it("Should handle removal from whitelist correctly", async function () {
            await vToken.addToWhitelist(whitelistedAddress.address);
            
            // Can mint while whitelisted
            const mintAmount = ethers.utils.parseEther("100");
            await vToken.connect(whitelistedAddress).mint(user1.address, mintAmount);
            
            // Remove from whitelist
            await vToken.removeFromWhitelist(whitelistedAddress.address);
            
            // Cannot mint after removal
            await expect(
                vToken.connect(whitelistedAddress).mint(user1.address, mintAmount)
            ).to.be.revertedWith("VirtualToken: not whitelisted");
        });

        it("Should handle large mint operations", async function () {
            await vToken.addToWhitelist(whitelistedAddress.address);
            
            // Mint a large amount
            const largeAmount = ethers.utils.parseEther("1000000000"); // 1 billion tokens
            await vToken.connect(whitelistedAddress).mint(user1.address, largeAmount);
            
            expect(await vToken.balanceOf(user1.address)).to.equal(largeAmount);
            expect(await vToken.totalSupply()).to.equal(largeAmount);
        });
    });

    describe("Integration Scenarios", function () {
        it("Should simulate NettingEngine minting for positions", async function () {
            // Setup: NettingEngine is whitelisted
            const nettingEngine = whitelistedAddress;
            await vToken.addToWhitelist(nettingEngine.address);
            
            // User opens long position - NettingEngine mints vETH
            const positionSize = ethers.utils.parseEther("1");
            await vToken.connect(nettingEngine).mint(user1.address, positionSize);
            
            expect(await vToken.balanceOf(user1.address)).to.equal(positionSize);
        });

        it("Should simulate position closing with burn", async function () {
            // Setup
            const nettingEngine = whitelistedAddress;
            await vToken.addToWhitelist(nettingEngine.address);
            
            const positionSize = ethers.utils.parseEther("1");
            await vToken.connect(nettingEngine).mint(user1.address, positionSize);
            
            // User closes position - NettingEngine burns vETH
            await vToken.connect(nettingEngine).burn(user1.address, positionSize);
            
            expect(await vToken.balanceOf(user1.address)).to.equal(0);
        });

        it("Should allow owner to mint tokens for pool initialization", async function () {
            // Owner needs to whitelist themselves first
            await vToken.addToWhitelist(owner.address);
            
            // Owner mints tokens for pool initialization
            const liquidityAmount = ethers.utils.parseEther("1000000");
            await vToken.mint(owner.address, liquidityAmount);
            
            const poolAddress = user2.address; // Mock pool
            await vToken.transfer(poolAddress, liquidityAmount);
            
            expect(await vToken.balanceOf(poolAddress)).to.equal(liquidityAmount);
        });
    });
});
