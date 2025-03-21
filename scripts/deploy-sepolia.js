// scripts/deploy-sepolia.js
const hre = require("hardhat");
const { ethers } = require("hardhat");
const { getRpcUrl } = require('../src/utils/rpc-provider');

async function main() {
  // Get network from Hardhat
  const network = await hre.ethers.provider.getNetwork();
  console.log(`Deploying to Sepolia network (chainId: ${network.chainId})`);

  // Get the deployer's address
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  // Display account balance
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH");

  // Deploy the FlashLoanArbitrage contract
  console.log("Deploying FlashLoanArbitrage contract...");
  const FlashLoanArbitrage = await hre.ethers.getContractFactory("FlashLoanArbitrage");
  const arbitrage = await FlashLoanArbitrage.deploy();
  
  console.log("Waiting for deployment transaction to be mined...");
  await arbitrage.waitForDeployment();
  
  const arbitrageAddress = await arbitrage.getAddress();
  console.log("FlashLoanArbitrage deployed to:", arbitrageAddress);
  
  console.log("Deployment completed!");
}

// Execute the deployment
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
