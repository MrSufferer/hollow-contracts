require("@nomiclabs/hardhat-waffle");
// require('hardhat-ethernal');

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
// task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
//   const accounts = await hre.ethers.getSigners();

//   for (const account of accounts) {
//     console.log(account.address);
//   }
// });
const nets = require('./network.json');

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity:  {
    compilers: [
      {
        version: "0.7.6",
        settings: { 
          optimizer: { enabled: true, runs: 100 } ,
          metadata: {
            bytecodeHash: "none"
          },
          debug: { revertStrings: "strip" }
        },
      },
      {
        version: "0.4.18",
        settings: { 
          optimizer: { enabled: true, runs: 200 } ,
          debug: { revertStrings: "strip" }
        },
      }
    ],
    overrides: {
      "contracts/WETH9.sol": {
        version: "0.4.18",
        settings: { 
          optimizer: { enabled: true, runs: 200 } ,
          debug: { revertStrings: "strip" }
        },
      }
    }
  },
  // solidity: "0.7.6",
  networks: nets
};
