// scripts/check-contract.js
const hre = require("hardhat");
const chalk = require("chalk");
const { getRpcUrl } = require('../src/utils/rpc-provider');

async function main() {
  const contractAddress = process.argv.length > 2 ? process.argv[2] : null;
  
  if (!contractAddress) {
    console.error(chalk.red("Error: Contract address is required"));
    console.log("Usage: npx hardhat run scripts/check-contract.js --network <network> <contractAddress>");
    process.exit(1);
  }
  
  console.log(chalk.blue(`Checking contract status for ${contractAddress} on ${hre.network.name}...`));
  
  try {
    // Get provider and signer
    const provider = hre.ethers.provider;
    const [signer] = await hre.ethers.getSigners();
    const signerAddress = await signer.getAddress();
    
    // Load contract
    const FlashLoanArbitrageOptimized = await hre.ethers.getContractFactory("FlashLoanArbitrageOptimized");
    const contract = FlashLoanArbitrageOptimized.attach(contractAddress);
    
    // Check if contract exists
    const code = await provider.getCode(contractAddress);
    if (code === '0x') {
      console.log(chalk.red("✗ No contract deployed at this address"));
      process.exit(1);
    }
    
    console.log(chalk.green("✓ Contract exists at this address"));
    
    // Check contract balance
    const balance = await provider.getBalance(contractAddress);
    console.log(chalk.yellow(`Contract balance: ${hre.ethers.utils.formatEther(balance)} ETH`));
    
    if (balance.lt(hre.ethers.utils.parseEther("0.05"))) {
      console.log(chalk.red("✗ Contract balance is low (less than 0.05 ETH)"));
    } else {
      console.log(chalk.green("✓ Contract has sufficient balance"));
    }
    
    // Check contract owner
    try {
      const owner = await contract.owner();
      console.log(chalk.yellow(`Contract owner: ${owner}`));
      
      if (owner.toLowerCase() === signerAddress.toLowerCase()) {
        console.log(chalk.green("✓ Current signer is the contract owner"));
      } else {
        console.log(chalk.red("✗ Current signer is NOT the contract owner"));
      }
    } catch (error) {
      console.log(chalk.red("✗ Failed to check contract owner"));
      console.log(chalk.red(`Error: ${error.message}`));
    }
    
    // Check WETH allowance
    try {
      const networkConfig = require('config').get(hre.network.name);
      const wethAddress = networkConfig.tokens.WETH;
      
      const ERC20ABI = [
        "function allowance(address owner, address spender) view returns (uint256)",
        "function balanceOf(address account) view returns (uint256)"
      ];
      
      const weth = new hre.ethers.Contract(wethAddress, ERC20ABI, provider);
      const allowance = await weth.allowance(contractAddress, networkConfig.swapRouters.uniswap);
      
      console.log(chalk.yellow(`WETH allowance to Uniswap: ${hre.ethers.utils.formatEther(allowance)} WETH`));
      
      if (allowance.gt(0)) {
        console.log(chalk.green("✓ Contract has WETH allowance for Uniswap"));
      } else {
        console.log(chalk.yellow("! Contract may need to approve WETH for Uniswap"));
      }
      
      // Check if contract has any WETH
      const wethBalance = await weth.balanceOf(contractAddress);
      console.log(chalk.yellow(`Contract WETH balance: ${hre.ethers.utils.formatEther(wethBalance)} WETH`));
    } catch (error) {
      console.log(chalk.yellow("! Could not check token allowances"));
      console.log(chalk.yellow(`Error: ${error.message}`));
    }
    
    // Try to estimate gas for a sample arbitrage
    try {
      const networkConfig = require('config').get(hre.network.name);
      const wethAddress = networkConfig.tokens.WETH;
      const usdcAddress = networkConfig.tokens.USDC;
      
      const gasEstimate = await contract.estimateGas.executeArbitrage(
        wethAddress,
        usdcAddress,
        hre.ethers.utils.parseEther("0.1"),
        0
      );
      
      console.log(chalk.green("✓ Successfully estimated gas for sample arbitrage"));
      console.log(chalk.yellow(`Gas estimate: ${gasEstimate.toString()}`));
    } catch (error) {
      console.log(chalk.red("✗ Failed to estimate gas for sample arbitrage"));
      console.log(chalk.red(`Error: ${error.message}`));
    }
    
    console.log(chalk.blue("\nContract status check completed"));
    
  } catch (error) {
    console.error(chalk.red("Failed to check contract status:"), error);
    process.exit(1);
  }
}

// Execute the script
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
