// scripts/test-multi-path-arbitrage.js
const { ethers } = require("hardhat");
const { MultiPathArbitrageStrategy } = require("../src/bot/MultiPathArbitrageStrategy");
const PriceOracleManager = require("../src/oracles/PriceOracleManager");
const { getRpcUrl } = require('../src/utils/rpc-provider');

async function main() {
  console.log("\n======= MULTI-PATH ARBITRAGE STRATEGY TEST =======");
  
  // Get the provider from Hardhat
  const provider = ethers.provider;
  
  // Define configuration similar to what's in your ArbitrageBot.js
  const config = {
    // DEXes to monitor
    supportedDexes: [
      {
        name: 'Uniswap V3',
        routerAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
        factoryAddress: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
        fee: 0.3, // 0.3% fee
      },
      {
        name: 'Curve',
        factoryAddress: '0xB9fC157394Af804a3578134A6585C0dc9cc990d4',
        fee: 0.04, // 0.04% base fee (can vary per pool)
      },
      {
        name: 'SushiSwap',
        routerAddress: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
        factoryAddress: '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac',
        fee: 0.3, // 0.3% fee
      }
    ],
    
    // Tokens to include in arbitrage paths
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
      },
      {
        symbol: 'USDT',
        address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        decimals: 6
      },
      {
        symbol: 'DAI',
        address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
        decimals: 18
      },
      {
        symbol: 'WBTC',
        address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
        decimals: 8
      }
    ],
    
    // Oracle configuration (mock for testing)
    oracles: {
      chainlink: {
        ethUsdFeed: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
        btcUsdFeed: '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c',
      }
    },
    
    // Flash loan providers
    flashLoanProviders: {
      aave: {
        lendingPoolAddress: '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9',
        fee: 0.09, // 0.09% fee
      }
    },
    
    // Other settings
    minProfitUsd: 5,
    maxGasPrice: 100, // gwei
    priorityFee: 2, // gwei
    slippageTolerance: 0.5 // 0.5%
  };
  
  // Create a mock price oracle for testing
  // In a real scenario, you'd use your actual PriceOracleManager
  const mockPriceOracle = {
    getTokenPrice: async (symbol) => {
      // Return mock prices for testing
      const prices = {
        'WETH': 2500,
        'USDC': 1,
        'USDT': 1,
        'DAI': 1,
        'WBTC': 50000
      };
      return prices[symbol] || 0;
    },
    getGasPriceUsd: async (gasUnits) => {
      // Mock gas price calculation
      return {
        gasPrice: 50, // gwei
        gasCostEth: gasUnits * 50 * 1e-9,
        gasCostUsd: gasUnits * 50 * 1e-9 * 2500 // ETH price * gas cost in ETH
      };
    }
  };
  
  // Initialize the multi-path arbitrage strategy
  console.log("Initializing MultiPathArbitrageStrategy...");
  const strategy = new MultiPathArbitrageStrategy(provider, config, mockPriceOracle);
  
  // Test different starting tokens and amounts
  const testCases = [
    {
      tokenSymbol: 'WETH',
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      amount: ethers.parseEther('10'),
      maxPathLength: 4
    },
    {
      tokenSymbol: 'USDC',
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      amount: ethers.parseUnits('10000', 6),
      maxPathLength: 4
    },
    {
      tokenSymbol: 'DAI',
      address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      amount: ethers.parseEther('10000'),
      maxPathLength: 4
    }
  ];
  
  // Run tests
  for (const testCase of testCases) {
    console.log(`\n======= Testing with ${ethers.formatUnits(testCase.amount, testCase.tokenSymbol === 'USDC' ? 6 : 18)} ${testCase.tokenSymbol} =======`);
    
    try {
      console.log(`Finding arbitrage paths (max length: ${testCase.maxPathLength})...`);
      
      // Call the findArbitragePath method
      const startTime = Date.now();
      const path = await strategy.findArbitragePath(
        testCase.address,
        testCase.amount,
        testCase.maxPathLength
      );
      const endTime = Date.now();
      
      console.log(`Path finding completed in ${(endTime - startTime) / 1000} seconds`);
      
      if (path) {
        // Format the path for display
        const formattedPath = path.path.map(address => {
          const token = config.tokens.find(t => t.address.toLowerCase() === address.toLowerCase());
          return token ? token.symbol : address.substring(0, 6) + '...';
        });
        
        console.log(`\n✅ Found profitable path: ${formattedPath.join(' -> ')}`);
        console.log(`Expected output: ${ethers.formatUnits(path.expectedOutput, testCase.tokenSymbol === 'USDC' ? 6 : 18)} ${testCase.tokenSymbol}`);
        console.log(`Profit: ${ethers.formatUnits(path.profit, testCase.tokenSymbol === 'USDC' ? 6 : 18)} ${testCase.tokenSymbol}`);
        
        // Calculate profit percentage
        const profitPercentage = Number(path.profit * 10000n / testCase.amount) / 100;
        console.log(`Profit percentage: ${profitPercentage.toFixed(4)}%`);
        
        // Check if the path would be profitable after costs
        const profitabilityCheck = await strategy.isProfitable(path);
        console.log(`\nProfitability check:`);
        console.log(`- Profitable: ${profitabilityCheck.profitable}`);
        console.log(`- Profit (USD): $${profitabilityCheck.profitUsd?.toFixed(2) || 'N/A'}`);
        console.log(`- Gas cost (USD): $${profitabilityCheck.gasCostUsd?.toFixed(2) || 'N/A'}`);
        console.log(`- Flash loan fee (USD): $${profitabilityCheck.flashLoanFeeUsd?.toFixed(2) || 'N/A'}`);
        console.log(`- Net profit (USD): $${profitabilityCheck.netProfitUsd?.toFixed(2) || 'N/A'}`);
        console.log(`- Reason: ${profitabilityCheck.reason}`);
        
        // Print detailed path information
        console.log(`\nDetailed path:`);
        for (let i = 0; i < path.dexPath.length; i++) {
          const step = path.dexPath[i];
          const fromToken = config.tokens.find(t => t.address.toLowerCase() === step.from.toLowerCase());
          const toToken = config.tokens.find(t => t.address.toLowerCase() === step.to.toLowerCase());
          console.log(`Step ${i + 1}: ${fromToken?.symbol || step.from.substring(0, 6) + '...'} -> ${toToken?.symbol || step.to.substring(0, 6) + '...'} (${step.dex})`);
        }
      } else {
        console.log(`❌ No profitable path found for ${testCase.tokenSymbol}`);
      }
    } catch (error) {
      console.error(`Error testing with ${testCase.tokenSymbol}:`, error);
    }
  }
  
  console.log("\n======= MULTI-PATH ARBITRAGE TEST COMPLETE =======");
}

// Execute the script
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
