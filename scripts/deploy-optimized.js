// scripts/deploy-optimized.js
const hre = require("hardhat");
const config = require("config");
const { ethers } = require("hardhat");

async function main() {
  // Get network configuration
  const network = hre.network.name;
  console.log(`Deploying FlashLoanArbitrageOptimized to ${network}...`);

  // Load network-specific configuration
  const networkConfig = config.get(network);
  const { lendingPoolAddressesProvider, swapRouters } = networkConfig;

  if (!lendingPoolAddressesProvider) {
    throw new Error(`Missing lendingPoolAddressesProvider for network ${network}`);
  }
  
  if (!swapRouters || !swapRouters.uniswap || !swapRouters.sushiswap) {
    throw new Error(`Missing router configurations for network ${network}`);
  }

  // Deploy contract with constructor arguments
  const FlashLoanArbitrageOptimized = await hre.ethers.getContractFactory("FlashLoanArbitrageOptimized");
  
  const flashLoanArbitrage = await FlashLoanArbitrageOptimized.deploy(
    lendingPoolAddressesProvider,
    swapRouters.uniswap,
    swapRouters.sushiswap
  );

  await flashLoanArbitrage.deployed();

  console.log(`FlashLoanArbitrageOptimized deployed to: ${flashLoanArbitrage.address}`);
  console.log(`\nVerification command:`);
  console.log(`npx hardhat verify --network ${network} ${flashLoanArbitrage.address} "${lendingPoolAddressesProvider}" "${swapRouters.uniswap}" "${swapRouters.sushiswap}"`);

  // Additional post-deployment setup
  const owner = await flashLoanArbitrage.owner();
  console.log(`Contract owner set to: ${owner}`);
  
  // Print gas estimation for common operations
  const signer = (await hre.ethers.getSigners())[0];
  console.log(`\nGas estimations from ${signer.address}:`);
  
  // Example tokens to use for gas estimation
  const tokens = networkConfig.tokens || {};
  if (tokens.WETH && tokens.USDC) {
    console.log(`Estimating gas for executeArbitrage (WETH/USDC)...`);
    const gasEstimate = await flashLoanArbitrage.estimateGas.executeArbitrage(
      tokens.WETH,
      tokens.USDC,
      hre.ethers.utils.parseEther("1"), // 1 ETH loan amount
      0 // min profit
    ).catch(e => {
      console.log(`Gas estimation failed: ${e.message}`);
      return "Failed";
    });
    
    if (gasEstimate !== "Failed") {
      console.log(`Estimated gas: ${gasEstimate.toString()}`);
    }
  }

  return flashLoanArbitrage.address;
}

// Execute deployment
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
