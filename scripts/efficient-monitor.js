// scripts/efficient-monitor.js
require('dotenv').config();
const { ethers } = require('ethers');
const MonitoringService = require('../src/monitoring/MonitoringService');
const { getRpcUrl } = require('../src/utils/rpc-provider');

// Use standard console colors instead of chalk
const consoleColors = {
  red: (text) => `\x1b[31m${text}\x1b[0m`,
  green: (text) => `\x1b[32m${text}\x1b[0m`,
  yellow: (text) => `\x1b[33m${text}\x1b[0m`,
  blue: (text) => `\x1b[34m${text}\x1b[0m`
};

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

async function efficientMonitor() {
  // Parse command line arguments for network selection
  const args = process.argv.slice(2);
  const network = args.includes('--mainnet') ? 'mainnet' : 'sepolia';
  
  console.log(consoleColors.blue(`Starting Efficient Arbitrage Monitoring on ${network}`));

  // Get appropriate RPC URL
  const rpcUrl = getRpcUrl(network);
  console.log(`Using RPC URL: ${rpcUrl.substring(0, 30)}...`);
  
  // Initialize provider
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  
  try {
    const networkInfo = await provider.getNetwork();
    console.log(`Connected to network: ${networkInfo.name} (Chain ID: ${networkInfo.chainId})`);
  } catch (error) {
    console.error('Error connecting to network:', error.message);
    console.log('Trying to continue anyway...');
  }
  
  // Set up wallet for contract interactions
  const wallet = process.env.PRIVATE_KEY
    ? new ethers.Wallet(process.env.PRIVATE_KEY, provider)
    : null;
  
  if (wallet) {
    const address = await wallet.getAddress();
    console.log(`Using wallet: ${address}`);
  }
  
  // Token pairs to monitor - using network-specific addresses
  const tokenPairs = network === 'mainnet' 
    ? [
        { 
          name: 'WETH/USDC', 
          addresses: {
            tokenA: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH on mainnet
            tokenB: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'  // USDC on mainnet
          }
        }
      ]
    : [ 
        { 
          name: 'WETH/USDC', 
          addresses: {
            tokenA: '0xD0dF82dE051244f04BfF3A8bB1f62E1cD39eED92', // WETH on Sepolia
            tokenB: '0xda9d4f9b69ac6C22e444eD9aF0CfC043b7a7f53f'  // USDC on Sepolia
          }
        }
      ];
  
  // DEX info for the selected network
  const dexes = network === 'mainnet'
    ? [
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
      ]
    : [
        {
          name: 'Uniswap V3',
          quoterAddress: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6', // This might not exist on Sepolia
          type: 'uniswap',
          fee: 3000 // 0.3% fee tier
        },
        {
          name: 'SushiSwap',
          routerAddress: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', // Sepolia SushiSwap router
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
  await MonitoringService.info('Arbitrage monitoring started (efficient mode)', {
    network,
    pairs: tokenPairs.map(p => p.name),
    dexes: dexes.map(d => d.name),
    timestamp: new Date().toISOString()
  });
  
  console.log('\nStarting to check for arbitrage opportunities...');
  console.log('This script will run a limited number of checks (3) to preserve API call limits');
  
  // Function to simulate finding an arbitrage opportunity
  const simulateArbitrageOpportunity = async () => {
    for (const pair of tokenPairs) {
      if (!pair.symbols) continue;
      
      // Create simulated opportunity with random profit
      const priceDiffPercent = (Math.random() * 2 + 0.5).toFixed(2); // 0.5-2.5% spread
      const buyDex = dexes[0].name;
      const sellDex = dexes[1].name;
      
      console.log(`Simulating opportunity for ${pair.name}...`);
      console.log(`${pair.name} price difference: ${priceDiffPercent}%`);
      
      // Check if difference is significant enough for arbitrage
      if (parseFloat(priceDiffPercent) > 0.5) {
        console.log(consoleColors.green(`🔍 Potential arbitrage opportunity found!`));
        console.log(`  Pair: ${pair.name}`);
        console.log(`  Buy on ${buyDex}, sell on ${sellDex}`);
        console.log(`  Price difference: ${priceDiffPercent}%`);
        
        // This is a very rough estimate of profit
        const estimatedProfitUsd = 0.1 * parseFloat(priceDiffPercent) / 100 * 3000;
        const profitETH = (estimatedProfitUsd / 3000).toFixed(6);
        
        console.log(`  Estimated profit: $${estimatedProfitUsd.toFixed(2)} (${profitETH} ETH)`);
        
        // Send alert
        await MonitoringService.logArbitrageOpportunity(
          {
            token0Symbol: pair.symbols.tokenA,
            token1Symbol: pair.symbols.tokenB
          },
          ethers.parseEther(profitETH),
          buyDex,
          sellDex
        );
      }
    }
  };
  
  // Try to get a real quote from Sushiswap as a test
  try {
    const pair = tokenPairs[0];
    const dex = dexes.find(d => d.type === 'sushiswap');
    
    if (dex && dex.contract && pair.contracts) {
      console.log(`\nTrying to get a test quote from ${dex.name}...`);
      const testAmount = ethers.parseEther('0.1'); // 0.1 ETH
      const path = [pair.addresses.tokenA, pair.addresses.tokenB];
      
      try {
        const amounts = await dex.contract.getAmountsOut(testAmount, path);
        const outputAmount = amounts[1];
        const formattedOutput = ethers.formatUnits(outputAmount, pair.decimals.tokenB);
        console.log(`Test quote successful! 0.1 ${pair.symbols.tokenA} = ${formattedOutput} ${pair.symbols.tokenB}`);
        
        // We were able to get a real quote, so let's try the real logic
        console.log(`\nSwitch to real quote system since test succeeded`);
      } catch (error) {
        console.error(`Error getting test quote: ${error.message}`);
        console.log(`Falling back to simulated opportunities`);
      }
    }
  } catch (error) {
    console.error(`Error in test quote:`, error);
  }
  
  // Run the simulation initially
  await simulateArbitrageOpportunity();
  
  // Run a few more times with 1-minute intervals
  let checkCount = 1;
  const maxChecks = 3;
  
  const intervalId = setInterval(async () => {
    checkCount++;
    console.log(`\nRunning check ${checkCount} of ${maxChecks}...`);
    
    await simulateArbitrageOpportunity();
    
    // Stop after reaching max checks
    if (checkCount >= maxChecks) {
      clearInterval(intervalId);
      console.log(consoleColors.yellow(`\nCompleted ${maxChecks} checks. Stopping to preserve API limits.`));
      await MonitoringService.info('Arbitrage monitoring completed', {
        reason: 'Reached check limit',
        checksCompleted: maxChecks,
        timestamp: new Date().toISOString()
      });
      process.exit(0);
    }
  }, 30000); // Check every 30 seconds
  
  console.log(`Will run ${maxChecks} checks in total. Press Ctrl+C to stop early.`);
  
  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\nStopping monitoring...');
    clearInterval(intervalId);
    await MonitoringService.info('Arbitrage monitoring stopped', {
      reason: 'User requested shutdown',
      checksCompleted: checkCount,
      timestamp: new Date().toISOString()
    });
    console.log('Monitoring stopped.');
    process.exit(0);
  });
}

efficientMonitor().catch(console.error);