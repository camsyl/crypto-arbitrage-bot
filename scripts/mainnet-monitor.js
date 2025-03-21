// scripts/mainnet-monitor.js
require('dotenv').config();
const { ethers } = require('ethers');
const MonitoringService = require('../src/monitoring/MonitoringService');
const { getRpcUrl } = require('../src/utils/rpc-provider');

// ANSI colors
const colors = {
  green: (text) => `\x1b[32m${text}\x1b[0m`,
  yellow: (text) => `\x1b[33m${text}\x1b[0m`,
  red: (text) => `\x1b[31m${text}\x1b[0m`,
  blue: (text) => `\x1b[34m${text}\x1b[0m`
};

// ABI definitions
const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)"
];

const UNISWAP_QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)"
];

const SUSHI_ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)"
];

async function mainnetMonitor() {
    console.log('Starting Mainnet Arbitrage Monitoring');
    
    // Use the utility to get the correct Mainnet RPC URL
    const rpcUrl = getRpcUrl('mainnet');
    console.log(`Using Mainnet RPC URL: ${rpcUrl.substring(0, 30)}...`);
    
    const provider = new ethers.JsonRpcProvider(rpcUrl);
  
  try {
    const network = await provider.getNetwork();
    console.log(`Connected to ${network.name} (Chain ID: ${network.chainId})`);
    
    if (network.chainId !== 1n) {
      console.log(colors.red(`Warning: Not connected to Ethereum mainnet (Chain ID 1)`));
      console.log('Make sure your MAINNET_RPC_URL is correct');
    }
  } catch (error) {
    console.error(`Error connecting to network: ${error.message}`);
    process.exit(1);
  }
  
  // Setup wallet for contract calls that require a signer
  const wallet = process.env.PRIVATE_KEY 
    ? new ethers.Wallet(process.env.PRIVATE_KEY, provider)
    : null;
  
  console.log(`Using read-only mode (no transactions will be sent)`);
  
  // Token pairs to monitor - using real mainnet addresses
  const tokenPairs = [
    { 
      name: 'WETH/USDC', 
      addresses: {
        tokenA: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH on mainnet
        tokenB: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'  // USDC on mainnet
      }
    },
    { 
      name: 'WETH/USDT', 
      addresses: {
        tokenA: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH on mainnet
        tokenB: '0xdAC17F958D2ee523a2206206994597C13D831ec7'  // USDT on mainnet
      }
    }
  ];
  
  // DEX information for mainnet
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
  
  // Initialize token contracts
  for (const pair of tokenPairs) {
    try {
      const tokenA = new ethers.Contract(pair.addresses.tokenA, ERC20_ABI, provider);
      const tokenB = new ethers.Contract(pair.addresses.tokenB, ERC20_ABI, provider);
      
      // Get token symbols and decimals
      pair.symbols = {
        tokenA: await tokenA.symbol(),
        tokenB: await tokenB.symbol()
      };
      
      pair.decimals = {
        tokenA: await tokenA.decimals(),
        tokenB: await tokenB.decimals()
      };
      
      console.log(`Initialized pair: ${pair.symbols.tokenA}/${pair.symbols.tokenB}`);
    } catch (error) {
      console.error(`Error initializing pair ${pair.name}: ${error.message}`);
    }
  }
  
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
      console.error(`Error initializing ${dex.name} contract: ${error.message}`);
    }
  }
  
  // Report startup to monitoring
  await MonitoringService.info('Mainnet arbitrage monitoring started', {
    pairs: tokenPairs.map(p => p.name),
    dexes: dexes.map(d => d.name),
    timestamp: new Date().toISOString()
  });
  
  console.log(colors.blue('\nStarting to check for real arbitrage opportunities...'));
  console.log(`Will run a limited number of checks to preserve API limits`);
  
  // Function to check for real arbitrage opportunities
  const checkArbitrageOpportunities = async () => {
    for (const pair of tokenPairs) {
      if (!pair.symbols || !pair.decimals) {
        console.log(`Skipping ${pair.name} - not initialized`);
        continue;
      }
      
      try {
        console.log(`\nChecking ${pair.symbols.tokenA}/${pair.symbols.tokenB}...`);
        
        // Amount to test (0.1 ETH worth)
        const testAmount = ethers.parseEther('0.1');
        
        // Get quotes from each DEX
        const quotes = [];
        
        for (const dex of dexes) {
          if (!dex.contract) continue;
          
          try {
            console.log(`Getting quote from ${dex.name}...`);
            let outputAmount;
            
            if (dex.type === 'uniswap') {
              // Get Uniswap quote
              outputAmount = await dex.contract.quoteExactInputSingle.staticCall(
                pair.addresses.tokenA,
                pair.addresses.tokenB,
                dex.fee,
                testAmount,
                0
              );
            } else if (dex.type === 'sushiswap') {
              // Get SushiSwap quote
              const path = [pair.addresses.tokenA, pair.addresses.tokenB];
              const amounts = await dex.contract.getAmountsOut(testAmount, path);
              outputAmount = amounts[1];
            }
            
            // Format the output amount for display
            const formattedOutput = ethers.formatUnits(
              outputAmount,
              pair.decimals.tokenB
            );
            
            quotes.push({
              dex: dex.name,
              outputAmount: outputAmount,
              formattedOutput: formattedOutput
            });
            
            console.log(`${dex.name}: 0.1 ${pair.symbols.tokenA} = ${formattedOutput} ${pair.symbols.tokenB}`);
          } catch (error) {
            console.error(`Error getting quote from ${dex.name}: ${error.message}`);
          }
        }
        
        // If we have at least 2 quotes, compare them for arbitrage
        if (quotes.length >= 2) {
          // Sort by output amount (highest first)
          quotes.sort((a, b) => Number(b.outputAmount) - Number(a.outputAmount));
          
          // Get best and worst prices
          const bestQuote = quotes[0];
          const worstQuote = quotes[quotes.length - 1];
          
          // Calculate price difference
          const priceDiffPercent = (
            (Number(bestQuote.formattedOutput) - Number(worstQuote.formattedOutput)) / 
            Number(worstQuote.formattedOutput) * 100
          ).toFixed(2);
          
          console.log(`Price difference: ${priceDiffPercent}%`);
          
          // Check if difference is significant enough for arbitrage
          if (parseFloat(priceDiffPercent) > 0.5) {
            console.log(colors.green(`🔍 REAL arbitrage opportunity found!`));
            console.log(`  Pair: ${pair.symbols.tokenA}/${pair.symbols.tokenB}`);
            console.log(`  Buy on ${worstQuote.dex}, sell on ${bestQuote.dex}`);
            console.log(`  Price difference: ${priceDiffPercent}%`);
            
            // Get WETH price for profit calculation (rough estimate)
            const wethPriceUsd = 3000; // Approximate ETH price in USD
            
            // Calculate estimated profit
            const testAmountEth = 0.1; // 0.1 ETH
            const estimatedProfitUsd = testAmountEth * parseFloat(priceDiffPercent) / 100 * wethPriceUsd;
            const profitEth = estimatedProfitUsd / wethPriceUsd;
            
            console.log(`  Estimated profit: $${estimatedProfitUsd.toFixed(2)} (${profitEth.toFixed(6)} ETH)`);
            
            // Account for gas costs (rough estimate)
            const gasCostEth = 0.005; // Approximate gas cost for arbitrage
            const netProfitUsd = estimatedProfitUsd - (gasCostEth * wethPriceUsd);
            
            console.log(`  Gas cost (est.): $${(gasCostEth * wethPriceUsd).toFixed(2)} (${gasCostEth} ETH)`);
            console.log(`  Net profit: $${netProfitUsd.toFixed(2)}`);
            
            if (netProfitUsd > 0) {
              console.log(colors.green(`  ✅ Profitable opportunity!`));
              
              // Send alert via monitoring
              await MonitoringService.logArbitrageOpportunity(
                {
                  token0Symbol: pair.symbols.tokenA,
                  token1Symbol: pair.symbols.tokenB
                },
                ethers.parseEther(profitEth.toFixed(6)),
                worstQuote.dex,
                bestQuote.dex
              );
            } else {
              console.log(colors.red(`  ❌ Not profitable after gas costs`));
            }
          } else {
            console.log(`No significant arbitrage opportunity (${priceDiffPercent}% < 0.5%)`);
          }
        } else {
          console.log(`Not enough quotes to compare (need at least 2)`);
        }
      } catch (error) {
        console.error(`Error checking arbitrage for ${pair.name}: ${error.message}`);
      }
    }
  };
  
  // Run a limited number of checks
  const maxChecks = 5;
  let checkCount = 0;
  
  // Initial check
  await checkArbitrageOpportunities();
  checkCount++;
  
  // Schedule regular checks
  const intervalId = setInterval(async () => {
    checkCount++;
    console.log(colors.blue(`\n--- Check ${checkCount}/${maxChecks} ---`));
    
    await checkArbitrageOpportunities();
    
    // Stop after reaching max checks
    if (checkCount >= maxChecks) {
      clearInterval(intervalId);
      console.log(colors.yellow(`\nCompleted ${maxChecks} checks. Stopping to preserve API limits.`));
      
      await MonitoringService.info('Mainnet monitoring completed', {
        reason: 'Reached maximum checks',
        checksCompleted: maxChecks,
        timestamp: new Date().toISOString()
      });
      
      process.exit(0);
    }
  }, 60000); // Check every minute
  
  console.log(`Will run ${maxChecks} checks total. Press Ctrl+C to stop early.`);
  
  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\nStopping monitoring...');
    clearInterval(intervalId);
    
    await MonitoringService.info('Mainnet monitoring stopped', {
      reason: 'User requested shutdown',
      checksCompleted: checkCount,
      timestamp: new Date().toISOString()
    });
    
    console.log('Monitoring stopped.');
    process.exit(0);
  });
}

mainnetMonitor().catch(console.error);