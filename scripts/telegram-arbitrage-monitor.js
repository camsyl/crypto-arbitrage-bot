// scripts/telegram-arbitrage-monitor.js
require('dotenv').config();
const { ethers } = require('ethers');
const MonitoringService = require('../src/monitoring/MonitoringService');
const TelegramMonitor = require('../src/monitoring/TelegramMonitor');
const ValidationManager = require('../src/utils/ValidationManager');
const chalk = require('chalk');
const config = require('config');
const { getRpcUrl } = require('../src/utils/rpc-provider');

// Token addresses - expanded list including tokens known for inefficiencies
const TOKENS = {
  // Major tokens
  WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
  USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  
  // DeFi tokens - often more volatile
  AAVE: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9",
  UNI: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
  COMP: "0xc00e94Cb662C3520282E6f5717214004A7f26888",
  MKR: "0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2",
  SNX: "0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F",
  
  // Stablecoins with different mechanisms
  FRAX: "0x853d955aCEf822Db058eb8505911ED77F175b99e",
  LUSD: "0x5f98805A4E8be255a32880FDeC7F6728C6568bA0",
  GUSD: "0x056Fd409E1d7A124BD7017459dFEa2F387b6d5Cd",
  
  // Liquid staking tokens - often different pricing mechanisms
  STETH: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",
  RETH: "0xae78736Cd615f374D3085123A210448E74Fc6393",
  
  // Wrapped assets
  WSTETH: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
  HBTC: "0x0316EB71485b0Ab14103307bf65a021042c6d380",
  
  // Tokens with lower liquidity but higher spread potential
  BAL: "0xba100000625a3754423978a60c9317c58a424e3D",
  SUSHI: "0x6B3595068778DD592e39A122f4f5a5cF09C90fE2",
  CVX: "0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B"
};

// DEX addresses
const DEX = {
  UniswapV3Router: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
  UniswapV3Quoter: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",
  SushiswapRouter: "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F",
  CurveAddressProvider: "0x0000000022D53366457F9d5E68Ec105046FC4383"
};

// ABIs
const UniswapV3QuoterABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)"
];

const SushiswapRouterABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)"
];

const ERC20ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)"
];

// Fee tiers for Uniswap V3
const UniswapV3FeeTiers = [100, 500, 3000, 10000]; // 0.01%, 0.05%, 0.3%, 1%

// Get configuration
const arbitrageConfig = config.get('arbitrage');
const validationConfig = config.get('validation');
const MIN_PROFIT_USD = arbitrageConfig.minProfitUsd;
const SCAN_INTERVAL_MS = arbitrageConfig.scanInterval;
const MIN_SPREAD_PERCENT = validationConfig.price.minSpreadPercent;
const MIN_LIQUIDITY_USD = validationConfig.liquidity.minLiquidityUSD;

// Utility function to format price difference
function formatPriceDiff(diff) {
  return diff.toFixed(2) + '%';
}

// Utility function to estimate USD value
function estimateUsdValue(amount, tokenSymbol, decimals) {
  // Simple price estimator for common tokens
  const prices = {
    'WETH': 3000,
    'ETH': 3000,
    'WBTC': 60000,
    'BTC': 60000,
    'USDC': 1,
    'USDT': 1,
    'DAI': 1,
    'FRAX': 1,
    'LUSD': 1,
    'GUSD': 1
  };
  
  const price = prices[tokenSymbol] || 0;
  return Number(ethers.formatUnits(amount, decimals)) * price;
}

async function main() {
  console.log(chalk.blue.bold('🚀 Starting Real-time Arbitrage Monitor with Telegram Notifications'));
  console.log(chalk.blue('======================================================='));
  
  // Connect to mainnet
  const network = 'mainnet';
  const rpcUrl = getRpcUrl(network);
  console.log(`Connecting to ${network} via RPC: ${rpcUrl.substring(0, 30)}...`);
  
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  
  // Get network info
  const networkInfo = await provider.getNetwork();
  console.log(`Connected to ${networkInfo.name} (Chain ID: ${networkInfo.chainId})`);
  
  // Set up wallet for contract interactions (read-only is fine for monitoring)
  console.log('Setting up contracts...');
  
  // Initialize DEX contracts
  const uniswapQuoter = new ethers.Contract(DEX.UniswapV3Quoter, UniswapV3QuoterABI, provider);
  const sushiswapRouter = new ethers.Contract(DEX.SushiswapRouter, SushiswapRouterABI, provider);
  
  // Initialize token info
  console.log(chalk.yellow('Loading token information...'));
  const tokenInfo = {};
  
  for (const [symbol, address] of Object.entries(TOKENS)) {
    try {
      const token = new ethers.Contract(address, ERC20ABI, provider);
      try {
        const decimals = await token.decimals();
        let symbolValue = symbol;
        try {
          symbolValue = await token.symbol();
        } catch {
          // Keep the key as symbol if symbol() call fails
        }
        tokenInfo[symbol] = { address, decimals, symbol: symbolValue };
        console.log(`- ${symbol}: ${address} (${decimals} decimals)`);
      } catch (error) {
        console.log(`Could not get decimals for ${symbol}, skipping this token`);
      }
    } catch (error) {
      console.log(`Error initializing ${symbol} at ${address}, skipping this token`);
    }
  }
  
  // Build token pair combinations
  const tokenSymbols = Object.keys(tokenInfo);
  const tokenPairs = [];
  
  for (let i = 0; i < tokenSymbols.length; i++) {
    for (let j = i + 1; j < tokenSymbols.length; j++) {
      // Skip pairs where we already know there's no liquidity or high correlation
      const pair = {
        tokenA: tokenSymbols[i],
        tokenB: tokenSymbols[j]
      };
      
      // Check if both tokens have info
      if (tokenInfo[pair.tokenA] && tokenInfo[pair.tokenB]) {
        tokenPairs.push(pair);
      }
    }
  }
  
  console.log(chalk.green(`Generated ${tokenPairs.length} token pairs to monitor`));
  
  // Send startup notification
  await MonitoringService.info('🚀 Arbitrage monitoring started', {
    pairs: tokenPairs.length,
    minProfitUsd: MIN_PROFIT_USD,
    minSpreadPercent: MIN_SPREAD_PERCENT,
    scanInterval: SCAN_INTERVAL_MS,
    timestamp: new Date().toISOString()
  });
  
  // Test amounts for different tokens
  const getTestAmounts = (symbol) => {
    const info = tokenInfo[symbol];
    if (!info) return [];
    
    // Scale amounts based on token type
    if (symbol === 'WETH') {
      return [
        ethers.parseUnits("0.1", info.decimals), // Small amount to test initial liquidity
        ethers.parseUnits("1", info.decimals),   // Medium amount for realistic arb
        ethers.parseUnits("5", info.decimals)    // Larger amount to test depth
      ];
    } else if (symbol === 'WBTC') {
      return [
        ethers.parseUnits("0.01", info.decimals),
        ethers.parseUnits("0.1", info.decimals),
        ethers.parseUnits("0.5", info.decimals)
      ];
    } else if (['USDC', 'USDT', 'DAI', 'LUSD', 'GUSD', 'FRAX'].includes(symbol)) {
      return [
        ethers.parseUnits("100", info.decimals),
        ethers.parseUnits("1000", info.decimals),
        ethers.parseUnits("10000", info.decimals)
      ];
    } else {
      // For other tokens, use medium amounts
      return [
        ethers.parseUnits("10", info.decimals),
        ethers.parseUnits("100", info.decimals),
        ethers.parseUnits("1000", info.decimals)
      ];
    }
  };
  
  console.log(chalk.cyan('Starting continuous monitoring loop...'));
  console.log('Press Ctrl+C to stop monitoring\n');
  
  // Track already notified opportunities to avoid spam
  const notifiedOpportunities = new Map();
  
  // Function to monitor opportunities
  const monitorOpportunities = async () => {
    try {
      console.log(`\nScanning for arbitrage opportunities at ${new Date().toLocaleTimeString()}...`);
      
      // Track opportunities found in this scan
      const foundOpportunities = [];
      
      // Scan all pairs
      for (const pair of tokenPairs) {
        const tokenA = pair.tokenA;
        const tokenB = pair.tokenB;
        
        if (!tokenInfo[tokenA] || !tokenInfo[tokenB]) continue;
        
        // Get test amounts for this token
        const testAmountsForToken = getTestAmounts(tokenA);
        if (testAmountsForToken.length === 0) continue;
        
        // Use the medium test amount
        const amount = testAmountsForToken[1];
        const amountFormatted = ethers.formatUnits(amount, tokenInfo[tokenA].decimals);
        
        try {
          // Check Uniswap V3 (across all fee tiers)
          let bestUniswapRate = 0n;
          let bestFeeTier = 0;
          
          for (const feeTier of UniswapV3FeeTiers) {
            try {
              const uniswapOutput = await uniswapQuoter.quoteExactInputSingle.staticCall(
                tokenInfo[tokenA].address,
                tokenInfo[tokenB].address,
                feeTier,
                amount,
                0
              );
              
              if (uniswapOutput > bestUniswapRate) {
                bestUniswapRate = uniswapOutput;
                bestFeeTier = feeTier;
              }
            } catch (error) {
              // Skip this fee tier if no liquidity
            }
          }
          
          // Check Sushiswap
          let sushiswapOutput = 0n;
          try {
            const path = [tokenInfo[tokenA].address, tokenInfo[tokenB].address];
            const amounts = await sushiswapRouter.getAmountsOut(amount, path);
            sushiswapOutput = amounts[1];
          } catch (error) {
            // Skip if no liquidity
          }
          
          // If we have quotes from multiple DEXes, check for arbitrage
          if (bestUniswapRate > 0n && sushiswapOutput > 0n) {
            // Compare quotes
            const uniswapFormatted = ethers.formatUnits(bestUniswapRate, tokenInfo[tokenB].decimals);
            const sushiswapFormatted = ethers.formatUnits(sushiswapOutput, tokenInfo[tokenB].decimals);
            
            // Calculate percentage difference
            let priceDiffPercent, buyDex, sellDex, buyRate, sellRate;
            
            if (bestUniswapRate > sushiswapOutput) {
              // Uniswap has better rate
              priceDiffPercent = (Number(bestUniswapRate - sushiswapOutput) * 100) / Number(sushiswapOutput);
              buyDex = 'Sushiswap';
              sellDex = `Uniswap V3 (${bestFeeTier/10000}%)`;
              buyRate = sushiswapFormatted;
              sellRate = uniswapFormatted;
            } else {
              // Sushiswap has better rate
              priceDiffPercent = (Number(sushiswapOutput - bestUniswapRate) * 100) / Number(bestUniswapRate);
              buyDex = `Uniswap V3 (${bestFeeTier/10000}%)`;
              sellDex = 'Sushiswap';
              buyRate = uniswapFormatted;
              sellRate = sushiswapFormatted;
            }
            
            // Check if difference is significant enough
            if (priceDiffPercent > MIN_SPREAD_PERCENT) {
              // Estimate profit in USD
              const profitRate = priceDiffPercent / 100;
              const profitAmountToken = amount * BigInt(Math.floor(profitRate * 10000)) / 10000n;
              const profitUsd = estimateUsdValue(profitAmountToken, tokenA, tokenInfo[tokenA].decimals);
              
              // Additional validation to filter out unrealistic opportunities
              const MAX_REALISTIC_SPREAD = 15; // 15% is already very high for real arbitrage
              const isRealisticSpread = priceDiffPercent <= MAX_REALISTIC_SPREAD;
              
              // Ensure the profit meets minimum threshold and is realistic
              if (profitUsd >= MIN_PROFIT_USD && isRealisticSpread) {
                // Generate a unique ID for this opportunity
                const opportunityId = `${tokenA}-${tokenB}-${buyDex}-${sellDex}`;
                
                // Check if we've already notified for this opportunity recently
                const lastNotified = notifiedOpportunities.get(opportunityId);
                const now = Date.now();
                
                // Only notify if it's a new opportunity or if 5 minutes have passed
                if (!lastNotified || (now - lastNotified > 5 * 60 * 1000)) {
                  console.log(chalk.green(`🔍 Arbitrage opportunity found: ${tokenA}/${tokenB}`));
                  console.log(`   Buy on ${buyDex}, sell on ${sellDex}`);
                  console.log(`   Price difference: ${priceDiffPercent.toFixed(2)}%`);
                  console.log(`   Estimated profit: $${profitUsd.toFixed(2)}`);
                  
                  // Store this opportunity
                  foundOpportunities.push({
                    tokens: {
                      token0Symbol: tokenA,
                      token1Symbol: tokenB
                    },
                    profitAmount: profitAmountToken,
                    profitUsd,
                    priceDiffPercent,
                    buyDex,
                    sellDex,
                    buyRate,
                    sellRate,
                    id: opportunityId
                  });
                  
                  // Update the notification timestamp
                  notifiedOpportunities.set(opportunityId, now);
                }
              }
            }
          }
        } catch (error) {
          console.error(`Error checking ${tokenA}/${tokenB}:`, error.message);
        }
      }
      
      // If we found opportunities, send notifications
      if (foundOpportunities.length > 0) {
        // Sort by profit USD
        foundOpportunities.sort((a, b) => b.profitUsd - a.profitUsd);
        
        // Send notification for each opportunity (up to 3 to avoid spam)
        for (let i = 0; i < Math.min(3, foundOpportunities.length); i++) {
          const opp = foundOpportunities[i];
          
          await MonitoringService.logArbitrageOpportunity(
            opp.tokens,
            opp.profitAmount,
            {
              buyExchange: opp.buyDex,
              sellExchange: opp.sellDex,
              spread: formatPriceDiff(opp.priceDiffPercent),
              estimatedProfitUsd: `$${opp.profitUsd.toFixed(2)}`,
              buyRate: opp.buyRate,
              sellRate: opp.sellRate
            }
          );
          
          // Throttle API calls to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // If there are more opportunities, send a summary
        if (foundOpportunities.length > 3) {
          await MonitoringService.info(`🔍 ${foundOpportunities.length - 3} additional opportunities found`, {
            timestamp: new Date().toISOString()
          });
        }
      } else {
        console.log('No profitable arbitrage opportunities found in this scan');
      }
      
      // Clean up old notifications (older than 30 minutes)
      const now = Date.now();
      for (const [id, timestamp] of notifiedOpportunities.entries()) {
        if (now - timestamp > 30 * 60 * 1000) {
          notifiedOpportunities.delete(id);
        }
      }
      
    } catch (error) {
      console.error('Error during monitoring cycle:', error);
      await MonitoringService.error('Monitoring error', {
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
    }
  };
  
  // Run initially
  await monitorOpportunities();
  
  // Set interval for continuous monitoring
  const intervalId = setInterval(monitorOpportunities, SCAN_INTERVAL_MS);
  
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

// Execute the script
main().catch(async (error) => {
  console.error('Fatal error:', error);
  await MonitoringService.critical('Monitor crashed', {
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString()
  });
  process.exit(1);
});
