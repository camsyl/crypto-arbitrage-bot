// hardhat.config.js
require('@nomicfoundation/hardhat-ethers');
require('@nomicfoundation/hardhat-verify');
require('dotenv').config();

// Load custom tasks
require('./tasks/flash-loan-task');

// Import RPC utility
const { getRpcUrl } = require('./src/utils/rpc-provider');

module.exports = {
  solidity: {
    version: "0.8.10",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000  // Increase from 200 to 1000 for more gas optimization
      },
      viaIR: true   // Enable Intermediate Representation for extra optimization
    }
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY
  },
  networks: {
    hardhat: {
      forking: {
        url: getRpcUrl('mainnet'),
        blockNumber: 22075184 // Block number to fork from (latest block at time of writing) 
      },
      chainId: 1, // This ensures we're forking Ethereum mainnet
      mining: {
        auto: true, // Mine transactions immediately
        interval: 0  // No delay between blocks
      },
      allowUnlimitedContractSize: true // Helps with complex contracts
    },
    sepolia: {
      url: getRpcUrl('sepolia'),
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
    },
    mainnet: {
      url: getRpcUrl('mainnet'),
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
    }
  },
  mocha: {
    timeout: 200000 // Longer timeout for forking tests
  }
};
