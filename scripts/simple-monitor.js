// scripts/simple-monitor.js
require('dotenv').config();
const { ethers } = require('ethers');
const MonitoringService = require('../src/monitoring/MonitoringService');
const { getRpcUrl } = require('../src/utils/rpc-provider');

async function simpleMonitor() {
  console.log('Starting Simple Arbitrage Monitoring');
  
  // Set up provider using our utility
  const network = 'sepolia'; // Default to sepolia for this simple monitor
  const rpcUrl = getRpcUrl(network);
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  
  console.log(`Provider connected to ${network} using RPC URL: ${rpcUrl.substring(0, 30)}...`);
  
  // Set up token pairs to monitor
  const tokenPairs = [
    { 
      name: 'WETH/USDC', 
      addresses: {
        tokenA: '0xD0dF82dE051244f04BfF3A8bB1f62E1cD39eED92', // WETH on Sepolia
        tokenB: '0xda9d4f9b69ac6C22e444eD9aF0CfC043b7a7f53f'  // USDC on Sepolia
      },
      symbols: {
        tokenA: 'WETH',
        tokenB: 'USDC'
      }
    },
    { 
      name: 'WETH/DAI', 
      addresses: {
        tokenA: '0xD0dF82dE051244f04BfF3A8bB1f62E1cD39eED92', // WETH on Sepolia
        tokenB: '0x68194a729C2450ad26072b3D33ADaCbcef39D574'  // DAI on Sepolia
      },
      symbols: {
        tokenA: 'WETH',
        tokenB: 'DAI'
      }
    }
  ];
  
  // DEX info
  const dexes = [
    {
      name: 'Uniswap',
      routerAddress: '0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008' // Sepolia
    },
    {
      name: 'SushiSwap',
      routerAddress: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506' // Sepolia
    }
  ];
  
  console.log('Starting monitoring for pairs:');
  tokenPairs.forEach(pair => console.log(`- ${pair.name}`));
  
  // Report startup
  await MonitoringService.info('Simple arbitrage monitoring started', {
    pairs: tokenPairs.map(p => p.name),
    dexes: dexes.map(d => d.name),
    timestamp: new Date().toISOString()
  });
  
  // Set up interval to simulate monitoring
  const monitoringInterval = setInterval(async () => {
    try {
      // Simulate finding an opportunity (randomly)
      if (Math.random() < 0.3) { // 30% chance to "find" an opportunity
        const randomPairIndex = Math.floor(Math.random() * tokenPairs.length);
        const pair = tokenPairs[randomPairIndex];
        
        const opportunity = {
          tokenA: pair.symbols.tokenA,
          tokenB: pair.symbols.tokenB,
          buyDex: dexes[0].name,
          sellDex: dexes[1].name,
          profitUsd: (Math.random() * 30 + 5).toFixed(2), // $5-35 profit
          spreadPercentage: (Math.random() * 2 + 0.5).toFixed(2), // 0.5-2.5% spread
          rawProfit: (Math.random() * 0.02 + 0.005).toFixed(4) // 0.005-0.025 ETH profit
        };
        
        console.log(`${new Date().toLocaleTimeString()} - Opportunity found: ${pair.name}`);
        console.log(`  Profit: $${opportunity.profitUsd} (${opportunity.rawProfit} ETH)`);
        console.log(`  ${opportunity.buyDex} → ${opportunity.sellDex}, Spread: ${opportunity.spreadPercentage}%`);
        
        // Log to monitoring service
        await MonitoringService.logArbitrageOpportunity(
          {
            token0Symbol: opportunity.tokenA,
            token1Symbol: opportunity.tokenB
          },
          ethers.parseEther(opportunity.rawProfit),
          opportunity.buyDex,
          opportunity.sellDex
        );
      }
    } catch (error) {
      console.error('Error in monitoring:', error);
    }
  }, 15000); // Check every 15 seconds
  
  console.log('Monitoring started. Press Ctrl+C to stop.');
  
  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\nStopping monitoring...');
    clearInterval(monitoringInterval);
    await MonitoringService.info('Arbitrage monitoring stopped', {
      reason: 'User requested shutdown',
      timestamp: new Date().toISOString()
    });
    console.log('Monitoring stopped.');
    process.exit(0);
  });
}

simpleMonitor().catch(console.error);
