// bot-runner.js
const { ethers } = require('ethers');
require('dotenv').config();

async function main() {
  // Debug environment variables
  console.log("RPC_URL:", process.env.RPC_URL ? "Loaded (starts with " + process.env.RPC_URL.substring(0, 10) + "...)" : "Not loaded");
  console.log("PRIVATE_KEY:", process.env.PRIVATE_KEY ? "Loaded (hidden)" : "Not loaded");
  console.log("FLASH_LOAN_CONTRACT_ADDRESS:", process.env.FLASH_LOAN_CONTRACT_ADDRESS || "Not loaded");
  
  // Define provider URL - use a hardcoded value for now
  const providerUrl = "https://ethereum-sepolia-rpc.publicnode.com";
  console.log("Using provider URL:", providerUrl);
  
  try {
    // Create provider
    console.log("Creating provider...");
    const provider = new ethers.JsonRpcProvider(providerUrl);
    console.log("Provider created successfully");
    
    // Wait for provider to be ready
    console.log("Testing provider connection...");
    const blockNumber = await provider.getBlockNumber();
    console.log(`Connected to network, current block: ${blockNumber}`);
    
    console.log("Starting Enhanced Arbitrage Bot...");
    
    // Import EnhancedArbitrageBot
    console.log("Importing EnhancedArbitrageBot...");
    const ArbitrageBotModule = require('./src/bot/EnhancedArbitrageBot');
    const EnhancedArbitrageBot = ArbitrageBotModule.EnhancedArbitrageBot || ArbitrageBotModule;
    console.log("Import successful!");
    
    // Load configuration
    console.log("Loading config...");
    const config = {
      // Use the same provider URL in the config
      rpcUrl: providerUrl,
      privateKey: process.env.PRIVATE_KEY,
      flashLoanContractAddress: process.env.FLASH_LOAN_CONTRACT_ADDRESS,
      enableMultiPathArbitrage: false, // Set to false for initial testing
      enableCexDexArbitrage: false,
      autoExecute: false,
      simulateBeforeExecution: false, // Disable simulation for now
      maxGasPrice: 100,
      priorityFee: 2,
      minProfitUsd: 50,
      slippageTolerance: 0.5,
      supportedDexes: [
        {
          name: 'Uniswap V3',
          routerAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
          factoryAddress: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
          fee: 0.3
        },
        {
          name: 'SushiSwap',
          routerAddress: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
          factoryAddress: '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac',
          fee: 0.3
        }
      ],
      tokens: [
        {
          symbol: 'WETH',
          address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          decimals: 18
        },
        {
          symbol: 'USDC',
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          decimals: 6
        }
      ],
      flashLoanProviders: {
        aave: {
          lendingPoolAddress: '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9',
          fee: 0.09
        }
      },
      oracles: {
        // Skip Chainlink for now to avoid initialization errors
      }
    };
    console.log("Config loaded!");
    
    // Create bot instance with minimal features
    console.log("Creating bot instance...");
    const bot = new EnhancedArbitrageBot(provider, config);
    console.log("Bot instance created!");
    
    // Initialize with minimal functionality
    console.log("Initializing bot...");
    await bot.initialize();
    console.log("Bot initialized successfully!");
    
    // Register signal handlers for graceful shutdown
    process.on('SIGINT', () => {
      console.log('Stopping bot gracefully...');
      bot.stopScanning();
      setTimeout(() => process.exit(0), 1000);
    });
    
    // Start scanning
    console.log("Starting scanner...");
    await bot.startScanning();
    
  } catch (error) {
    console.error("Detailed error:", error);
    console.error("Error location:", error.stack);
  }
}

main().catch(error => {
  console.error("Unhandled error:", error);
});