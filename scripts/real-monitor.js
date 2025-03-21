// scripts/real-monitor.js
require('dotenv').config();
const { ethers } = require('ethers');
const MonitoringService = require('../src/monitoring/MonitoringService');
const chalk = require('chalk');
const { getRpcUrl } = require('../src/utils/rpc-provider');

// ABI snippets
const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)"
];

const UNISWAP_QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)"
];

const SUSHI_ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)"
];

async function monitorRealArbitrage() {
  console.log('Starting Real Arbitrage Monitoring');

  // Use our utility to get the appropriate RPC URL for mainnet
  const network = 'mainnet';
  const rpcUrl = getRpcUrl(network);
  console.log(`Using RPC URL for ${network}: ${rpcUrl.substring(0, 30)}...`);
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  
  try {
    const network = await provider.getNetwork();
    console.log(`Connected to network: ${network.name} (Chain ID: ${network.chainId})`);
  } catch (error) {
    console.error('Error connecting to network:', error.message);
    console.log('Trying to continue anyway...');
  }
  
  // Set up wallet for contract interactions
  const wallet = process.env.PRIVATE_KEY
    ? new ethers.Wallet(process.env.PRIVATE_KEY, provider)
    : null;
  
  // Token pairs to monitor - using mainnet addresses for real data
  const tokenPairs = [
    { 
      name: 'WETH/USDC', 
      addresses: {
        tokenA: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH on mainnet
        tokenB: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'  // USDC on mainnet
      }
    },
    { 
      name: 'WETH/DAI', 
      addresses: {
        tokenA: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH on mainnet
        tokenB: '0x6B175474E89094C44Da98b954EedeAC495271d0F'  // DAI on mainnet
      }
    }
  ];
  
  // DEX info for mainnet
  const dexes = [
    {
      name: 'Uniswap V3',
      quoterAddress: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
      type: 'uniswap',
      fee: 3000 // 0.3% fee tier
    },
    {
      name: 'SushiSwap',
      routerAddress: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
      type: 'sushiswap'
    }
  ];
  
  console.log('Initializing token contracts...');
  
  // Initialize token contracts and get symbols/decimals
  for (const pair of tokenPairs) {
    try {
      const tokenA = new ethers.Contract(pair.addresses.tokenA, ERC20_ABI, provider);
      const tokenB = new ethers.Contract(pair.addresses.tokenB, ERC20_ABI, provider);
      
      pair.symbols = {
        tokenA: await tokenA.symbol(),
        tokenB: await tokenB.symbol()
      };
      
      pair.decimals = {
        tokenA: await tokenA.decimals(),
        tokenB: await tokenB.decimals()
      };
      
      pair.contracts = {
        tokenA,
        tokenB
      };
      
      console.log(`Initialized pair: ${pair.symbols.tokenA}/${pair.symbols.tokenB}`);
    } catch (error) {
      console.error(`Error initializing pair ${pair.name}:`, error.message);
    }
  }
  
  console.log('Initializing DEX contracts...');
  
  // Initialize DEX contracts
  for (const dex of dexes) {
    try {
      if (dex.type === 'uniswap') {
        dex.contract = new ethers.Contract(dex.quoterAddress, UNISWAP_QUOTER_ABI, wallet || provider);
      } else if (dex.type === 'sushiswap') {
        dex.contract = new ethers.Contract(dex.routerAddress, SUSHI_ROUTER_ABI, provider);
      }
      console.log(`Initialized ${dex.name} contract`);
    } catch (error) {
      console.error(`Error initializing ${dex.name} contract:`, error.message);
    }
  }
  
  // Report startup
  await MonitoringService.info('Real arbitrage monitoring started', {
    pairs: tokenPairs.map(p => p.name),
    dexes: dexes.map(d => d.name),
    timestamp: new Date().toISOString()
  });
  
  console.log('\nStarting to check for arbitrage opportunities...');
  
  // Function to check for arbitrage opportunities
  const checkArbitrageOpportunities = async () => {
    for (const pair of tokenPairs) {
      if (!pair.symbols || !pair.decimals) {
        console.log(`Skipping ${pair.name} as it was not properly initialized`);
        continue; // Skip pairs that weren't initialized
      }
      
      try {
        // Define test amount (0.1 ETH worth for WETH, adjusted for other tokens)
        const testAmountDecimals = pair.symbols.tokenA === 'WETH' ? 
                             ethers.parseEther('0.1') : 
                             ethers.parseUnits('100', pair.decimals.tokenA);
        
        // Get quotes from each DEX
        const quotes = [];
        
        for (const dex of dexes) {
          if (!dex.contract) continue; // Skip if contract not initialized
          
          try {
            console.log(`Getting ${dex.name} quote for ${pair.name}...`);
            let outputAmount;
            
            if (dex.type === 'uniswap') {
              // Call Uniswap quoter
              outputAmount = await dex.contract.quoteExactInputSingle.staticCall(
                pair.addresses.tokenA,
                pair.addresses.tokenB,
                dex.fee,
                testAmountDecimals,
                0
              );
            } else if (dex.type === 'sushiswap') {
              // Call Sushiswap router
              const path = [pair.addresses.tokenA, pair.addresses.tokenB];
              const amounts = await dex.contract.getAmountsOut(testAmountDecimals, path);
              outputAmount = amounts[1];
            }
            
            // Format the output amount
            const formattedOutput = ethers.formatUnits(
              outputAmount, 
              pair.decimals.tokenB
            );
            
            quotes.push({
              dex: dex.name,
              outputAmount: outputAmount,
              formattedOutput: formattedOutput
            });
            
            console.log(`${dex.name} quote for ${pair.name}: ${formattedOutput} ${pair.symbols.tokenB}`);
          } catch (error) {
            console.error(`Error getting quote from ${dex.name} for ${pair.name}:`, error.message);
          }
        }
        
        // If we have quotes from multiple DEXes, check for arbitrage
        if (quotes.length >= 2) {
          // Sort quotes by output amount (descending)
          quotes.sort((a, b) => Number(b.outputAmount) - Number(a.outputAmount));
          
          // Compare best and worst quote
          const bestQuote = quotes[0];
          const worstQuote = quotes[quotes.length - 1];
          
          // Calculate percentage difference
          const priceDiffPercent = (
            (Number(bestQuote.formattedOutput) - Number(worstQuote.formattedOutput)) / 
            Number(worstQuote.formattedOutput) * 100
          ).toFixed(2);
          
          console.log(`${pair.name} price difference: ${priceDiffPercent}%`);
          
          // Check if difference is significant enough for arbitrage
          if (parseFloat(priceDiffPercent) > 0.5) { // 0.5% threshold
            console.log(chalk.green(`🔍 Potential arbitrage opportunity found!`));
            console.log(`  Pair: ${pair.name}`);
            console.log(`  Buy on ${worstQuote.dex}, sell on ${bestQuote.dex}`);
            console.log(`  Price difference: ${priceDiffPercent}%`);
            
            // Calculate estimated profit in tokenA
            const testAmountNormal = ethers.formatUnits(
              testAmountDecimals,
              pair.decimals.tokenA
            );
            
            // This is a very rough estimate since we're not accounting for the return swap
            const estimatedProfitUsd = parseFloat(testAmountNormal) * 
                                     parseFloat(priceDiffPercent) / 100 * 
                                     (pair.symbols.tokenA === 'WETH' ? 3000 : 1); // Approximate ETH price
            
            // Log to monitoring service
            await MonitoringService.logArbitrageOpportunity(
              {
                token0Symbol: pair.symbols.tokenA,
                token1Symbol: pair.symbols.tokenB
              },
              ethers.parseEther((estimatedProfitUsd / 3000).toFixed(6)), // Rough estimate in ETH
              worstQuote.dex,
              bestQuote.dex
            );
          }
        }
      } catch (error) {
        console.error(`Error checking arbitrage for ${pair.name}:`, error);
      }
    }
  };
  
  // Run initially
  await checkArbitrageOpportunities();
  
  // Then set interval to check periodically
  const intervalId = setInterval(checkArbitrageOpportunities, 60000); // Check every minute
  
  console.log('Monitoring real arbitrage opportunities. Press Ctrl+C to stop.');
  
  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\nStopping monitoring...');
    clearInterval(intervalId);
    await MonitoringService.info('Arbitrage monitoring stopped', {
      reason: 'User requested shutdown',
      timestamp: new Date().toISOString()
    });
    console.log('Monitoring stopped.');
    process.exit(0);
  });
}

monitorRealArbitrage().catch(console.error);
