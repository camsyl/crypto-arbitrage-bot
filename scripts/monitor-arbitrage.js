// scripts/monitor-arbitrage.js
require('dotenv').config();
const { ethers } = require('ethers');
const config = require('config');
const MonitoringService = require('../src/monitoring/MonitoringService');
const { getRpcUrl } = require('../src/utils/rpc-provider');

async function monitorArbitrage() {
  console.log('Starting Arbitrage Monitoring (No Execution)');
  
  // Get network from config or use a default
  const network = config.has('network') ? config.get('network') : 'sepolia';
  console.log(`Network: ${network}`);
  
  // Set up provider using our utility
  const rpcUrl = getRpcUrl(network);
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  console.log(`Using provider with RPC URL: ${rpcUrl.substring(0, 30)}...`);
  
  // Set up signer using the private key from .env
  let signer;
  if (process.env.PRIVATE_KEY) {
    signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const address = await signer.getAddress();
    console.log(`Using wallet: ${address}`);
  } else {
    console.error('No private key found in .env file');
    process.exit(1);
  }
  
  // Get contract address
  let contractAddress;
  try {
    contractAddress = process.env.FLASH_LOAN_CONTRACT_ADDRESS || 
                     (config.has(`${network}.contractAddress`) ? 
                      config.get(`${network}.contractAddress`) : 
                      "0xf07a9418C96171FA936DEf70154a6881E6580018");
  } catch (error) {
    contractAddress = "0xf07a9418C96171FA936DEf70154a6881E6580018"; // Default to your Sepolia contract
  }
  console.log(`Contract address: ${contractAddress}`);
  
  // Create a complete configuration for the bot
  // Standard token addresses on mainnet and sepolia
  const tokenAddresses = {
    mainnet: {
      WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
      WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599"
    },
    sepolia: {
      WETH: "0xD0dF82dE051244f04BfF3A8bB1f62E1cD39eED92",
      USDC: "0xda9d4f9b69ac6C22e444eD9aF0CfC043b7a7f53f",
      DAI: "0x68194a729C2450ad26072b3D33ADaCbcef39D574",
      WBTC: "0xFF82bB6DB46Ad9e6D5c7dB8152984a6B8958A89d"
    }
  };
  
  // Get the appropriate token addresses for the current network
  const networkTokens = tokenAddresses[network] || tokenAddresses.sepolia;
  
  // Create the token config objects
  const tokens = [
    { symbol: 'WETH', address: networkTokens.WETH, decimals: 18 },
    { symbol: 'USDC', address: networkTokens.USDC, decimals: 6 },
    { symbol: 'DAI', address: networkTokens.DAI, decimals: 18 },
    { symbol: 'WBTC', address: networkTokens.WBTC, decimals: 8 }
  ];
  
  // DEX router addresses
  const dexAddresses = {
    mainnet: {
      uniswap: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
      sushiswap: "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F"
    },
    sepolia: {
      uniswap: "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008", 
      sushiswap: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506"
    }
  };
  
  // Get the appropriate DEX addresses for the current network
  const networkDexes = dexAddresses[network] || dexAddresses.sepolia;
  
  // Import the bot directly
  const { EnhancedArbitrageBot } = require('../src/bot/EnhancedArbitrageBot');
  
  // Complete bot configuration
  const botConfig = {
    privateKey: process.env.PRIVATE_KEY,
    contractAddress: contractAddress,
    
    // Flash loan provider details
    flashLoanProviders: {
      aave: {
        lendingPoolAddress: "0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9",
        fee: 0.09, // 0.09% fee
      }
    },
    
    // DEX information
    supportedDexes: [
      {
        name: 'Uniswap V3',
        routerAddress: networkDexes.uniswap,
        fee: 0.3, // 0.3% fee
      },
      {
        name: 'SushiSwap',
        routerAddress: networkDexes.sushiswap,
        fee: 0.3, // 0.3% fee
      }
    ],
    
    // Token information
    tokens: tokens,
    
    // General configuration
    minProfitUsd: 5, // $5 minimum profit
    maxGasPrice: 100, // 100 gwei
    priorityFee: 2, // 2 gwei
    slippageTolerance: 0.5, // 0.5%
    
    // Execution settings
    autoExecute: false, // Disable execution
    enableMultiPathArbitrage: true,
    enableCexDexArbitrage: false
  };
  
  console.log('Bot configuration created with tokens:');
  botConfig.tokens.forEach(token => {
    console.log(`  ${token.symbol}: ${token.address}`);
  });
  
  // Initialize bot
  const bot = new EnhancedArbitrageBot(provider, botConfig);
  await bot.initialize();
  
  // Add listeners for opportunities and execution events
  bot.on('opportunityFound', (opportunity) => {
    console.log(`Opportunity found: ${opportunity.tokenA}/${opportunity.tokenB}`);
    console.log(`  Profit: ${opportunity.profitUsd} USD`);
    console.log(`  Spread: ${opportunity.spreadPercentage}%`);
    
    // Log to monitoring service
    MonitoringService.logArbitrageOpportunity(
      {
        token0Symbol: opportunity.tokenA,
        token1Symbol: opportunity.tokenB
      },
      ethers.parseEther(opportunity.rawProfit || '0'),
      opportunity.buyDex,
      opportunity.sellDex
    );
  });
  
  // Report startup
  await MonitoringService.info('Arbitrage monitoring started', {
    network,
    mode: 'monitoring-only',
    timestamp: new Date().toISOString()
  });
  
  // Start scanning
  console.log('Starting opportunity scanning...');
  bot.startScanning();
  
  console.log('Monitoring started. Press Ctrl+C to stop.');
  
  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\nStopping monitoring...');
    bot.stopScanning();
    await MonitoringService.info('Arbitrage monitoring stopped', {
      reason: 'User requested shutdown',
      timestamp: new Date().toISOString()
    });
    console.log('Monitoring stopped.');
    process.exit(0);
  });
}

monitorArbitrage().catch(console.error);
