// Test Runtime.pid() behavior
const { ethers } = require("hardhat");

async function main() {
    const [deployer, user1] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);
    console.log("User1:", user1.address);

    // Deploy a simple test contract that calls Runtime.pid()
    const TestRuntimePid = await ethers.getContractFactory("TestRuntimePid");
    const testContract = await TestRuntimePid.deploy();
    await testContract.deployed();
    console.log("✅ TestRuntimePid deployed:", testContract.address);

    // Test calling Runtime.pid()
    console.log("\n📞 Calling testGetPid()...");
    try {
        const tx = await testContract.connect(user1).testGetPid();
        const receipt = await tx.wait();
        console.log("  TX hash:", tx.hash);
        console.log("  TX status:", receipt.status);
        console.log("  Gas used:", receipt.gasUsed.toString());
        
        // Check the event
        const event = receipt.events?.find(e => e.event === "PidResult");
        if (event) {
            console.log("\n✅ Runtime.pid() returned:");
            console.log("  success:", event.args.success);
            console.log("  pidLength:", event.args.pidLength.toString());
            console.log("  pidValue:", event.args.pidValue);
        }
    } catch (err) {
        console.log("❌ testGetPid() failed:", err.message);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Test failed:", error);
        process.exit(1);
    });
