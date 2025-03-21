// scripts/pre-deployment-check.js
const hre = require("hardhat");
const config = require("config");
const chalk = require("chalk"); // You may need to install this: npm install chalk
const { getRpcUrl } = require('../src/utils/rpc-provider');

async function main() {
  console.log(chalk.blue("===== PRE-DEPLOYMENT CHECKLIST ====="));
  const network = hre.network.name;
  console.log(chalk.yellow(`Network: ${network}`));
  
  // 1. Check environment
  console.log(chalk.blue("\n1. Environment Check:"));
  try {
    const networkConfig = config.get(network);
    console.log(chalk.green("✓ Configuration for network exists"));
    
    const requiredConfigs = [
      "lendingPoolAddressesProvider",
      "swapRouters.uniswap",
      "swapRouters.sushiswap",
      "tokens.WETH"
    ];
    
    const missingConfigs = [];
    for (const configPath of requiredConfigs) {
      const parts = configPath.split('.');
      let currentConfig = networkConfig;
      let missing = false;
      
      for (const part of parts) {
        if (!currentConfig || !currentConfig[part]) {
          missing = true;
          break;
        }
        currentConfig = currentConfig[part];
      }
      
      if (missing) {
        missingConfigs.push(configPath);
        console.log(chalk.red(`✗ Missing config: ${configPath}`));
      } else {
        console.log(chalk.green(`✓ Config found: ${configPath} = ${currentConfig}`));
      }
    }
    
    if (missingConfigs.length > 0) {
      throw new Error(`Missing required configurations: ${missingConfigs.join(', ')}`);
    }
  } catch (error) {
    console.log(chalk.red(`✗ Configuration error: ${error.message}`));
    return false;
  }
  
  // 2. Check contract compilation
  console.log(chalk.blue("\n2. Contract Compilation Check:"));
  try {
    await hre.run("compile");
    console.log(chalk.green("✓ Contracts compiled successfully"));
  } catch (error) {
    console.log(chalk.red(`✗ Compilation error: ${error.message}`));
    return false;
  }
  
  // 3. Check account balance
  console.log(chalk.blue("\n3. Deployer Account Check:"));
  try {
    const [deployer] = await hre.ethers.getSigners();
    console.log(chalk.yellow(`Deployer address: ${deployer.address}`));
    
    const balance = await deployer.getBalance();
    const balanceInEth = hre.ethers.utils.formatEther(balance);
    console.log(chalk.yellow(`Balance: ${balanceInEth} ETH`));
    
    // Check if balance is sufficient (adjust threshold as needed)
    const minBalance = network === "mainnet" ? 0.2 : 0.05;
    if (parseFloat(balanceInEth) < minBalance) {
      console.log(chalk.red(`✗ Insufficient balance. Minimum recommended: ${minBalance} ETH`));
      return false;
    } else {
      console.log(chalk.green(`✓ Balance sufficient for deployment`));
    }
  } catch (error) {
    console.log(chalk.red(`✗ Account check error: ${error.message}`));
    return false;
  }
  
  // 4. Gas price check
  console.log(chalk.blue("\n4. Gas Price Check:"));
  try {
    const gasPrice = await hre.ethers.provider.getGasPrice();
    const gasPriceInGwei = hre.ethers.utils.formatUnits(gasPrice, "gwei");
    console.log(chalk.yellow(`Current gas price: ${gasPriceInGwei} Gwei`));
    
    // Set appropriate thresholds based on network
    const maxRecommendedGas = network === "mainnet" ? 150 : 50;
    if (parseFloat(gasPriceInGwei) > maxRecommendedGas) {
      console.log(chalk.red(`✗ Gas price is high. Consider waiting for lower gas prices.`));
    } else {
      console.log(chalk.green(`✓ Gas price is reasonable`));
    }
  } catch (error) {
    console.log(chalk.red(`✗ Gas price check error: ${error.message}`));
  }
  
  // 5. Estimate deployment cost
  console.log(chalk.blue("\n5. Deployment Cost Estimation:"));
  try {
    const FlashLoanArbitrageOptimized = await hre.ethers.getContractFactory("FlashLoanArbitrageOptimized");
    const networkConfig = config.get(network);
    
    // Get creation code
    const deploymentData = FlashLoanArbitrageOptimized.getDeployTransaction(
      networkConfig.lendingPoolAddressesProvider,
      networkConfig.swapRouters.uniswap,
      networkConfig.swapRouters.sushiswap
    ).data;
    
    // Estimate gas for deployment
    const gasEstimate = await hre.ethers.provider.estimateGas({
      data: deploymentData
    });
    
    const gasPrice = await hre.ethers.provider.getGasPrice();
    const deploymentCost = gasEstimate.mul(gasPrice);
    
    console.log(chalk.yellow(`Estimated gas: ${gasEstimate.toString()}`));
    console.log(chalk.yellow(`Estimated deployment cost: ${hre.ethers.utils.formatEther(deploymentCost)} ETH`));
  } catch (error) {
    console.log(chalk.red(`✗ Deployment cost estimation error: ${error.message}`));
  }
  
  console.log(chalk.blue("\n===== PRE-DEPLOYMENT CHECKLIST COMPLETE ====="));
  return true;
}

// Execute the checklist
main()
  .then((passed) => {
    if (passed) {
      console.log(chalk.green("\n✓ All checks passed. Ready for deployment!"));
      process.exit(0);
    } else {
      console.log(chalk.red("\n✗ Some checks failed. Please address the issues before deployment."));
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
