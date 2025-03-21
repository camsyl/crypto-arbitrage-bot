// scripts/deploy.js - Fixed script for ethers v6.7.1
const hre = require("hardhat");
const { ethers } = require("hardhat");
const { getRpcUrl } = require('../src/utils/rpc-provider');

async function main() {
  // Get network from Hardhat
  const network = await hre.ethers.provider.getNetwork();
  console.log(`Deploying to network: ${network.name} (chainId: ${network.chainId})`);

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
  
  // Verify the contract on Etherscan if not on a local network
  if (network.chainId !== 31337 && network.chainId !== 1337) {
    console.log("Waiting for block confirmations...");
    // Wait for 6 confirmations for Etherscan verification
    const deployTx = await arbitrage.deploymentTransaction();
    if (deployTx) {
      await deployTx.wait(6);
    }
    
    console.log("Verifying contract on Etherscan...");
    try {
      await hre.run("verify:verify", {
        address: arbitrageAddress,
        constructorArguments: [],
      });
      console.log("Contract verified on Etherscan");
    } catch (error) {
      console.log("Error verifying contract:", error.message);
    }
  }
  
  console.log("Deployment completed!");
  
  // Return the contract and address for testing purposes
  return { arbitrage, arbitrageAddress };
}

// Execute the deployment
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
