// Updated ArbitrageBot.js for ethers v6.7.1
const { ethers } = require('ethers');
const { FlashbotsBundleProvider } = require('@flashbots/ethers-provider-bundle');
const axios = require('axios');
require('dotenv').config();

// Configuration
const config = {
  // Provider details
  rpcUrl: process.env.RPC_URL,
  privateKey: process.env.PRIVATE_KEY,
  
  // Flash loan providers
  flashLoanProviders: {
    aave: {
      lendingPoolAddress: '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9', // Aave V2 Lending Pool
      fee: 0.09, // 0.09% fee
    },
    dydx: {
      soloMarginAddress: '0x1E0447b19BB6EcFdAe1e4AE1694b0C3659614e4e',
      fee: 0, // dYdX doesn't charge flash loan fees
    }
  },
  
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
  
  // Tokens to monitor for arbitrage opportunities
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
  
  // Oracle configuration
  oracles: {
    chainlink: {
      ethUsdFeed: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
      btcUsdFeed: '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c',
    }
  },
  
  // Minimum profit threshold (in USD)
  minProfitUsd: 50,
  
  // Gas price settings
  maxGasPrice: 100, // gwei
  priorityFee: 2, // gwei
  
  // Slippage tolerance
  slippageTolerance: 0.5, // 0.5%
  
  // Exchange API keys (for CEX opportunities)
  exchanges: {
    coinbase: {
      apiKey: process.env.COINBASE_API_KEY,
      apiSecret: process.env.COINBASE_API_SECRET,
    },
    kraken: {
      apiKey: process.env.KRAKEN_API_KEY,
      apiSecret: process.env.KRAKEN_API_SECRET,
    },
    crypto_com: {
      apiKey: process.env.CRYPTO_COM_API_KEY,
      apiSecret: process.env.CRYPTO_COM_API_SECRET,
    },
    ndax: {
      apiKey: process.env.NDAX_API_KEY,
      apiSecret: process.env.NDAX_API_SECRET,
    }
  }
};

// Initialize provider and signer
const provider = new ethers.JsonRpcProvider(config.rpcUrl);
const wallet = new ethers.Wallet(config.privateKey, provider);

// ABI interfaces
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)'
];

const UNISWAP_V3_QUOTER_ABI = [
  'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)'
];

const CURVE_POOL_ABI = [
  'function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)',
  'function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) returns (uint256)'
];

const AAVE_LENDING_POOL_ABI = [
  'function flashLoan(address receiverAddress, address[] calldata assets, uint256[] calldata amounts, uint256[] calldata modes, address onBehalfOf, bytes calldata params, uint16 referralCode) external'
];

// Class for the arbitrage bot
class ArbitrageBot {
  constructor() {
    this.provider = provider;
    this.wallet = wallet;
    this.dexes = this.initializeDexes();
    this.tokens = this.initializeTokens();
    this.flashLoanProviders = this.initializeFlashLoanProviders();
    this.oracles = this.initializeOracles();
    this.exchanges = this.initializeExchanges();
  }
  
  async initialize() {
    console.log('Initializing Arbitrage Bot...');
    
    // Setup Flashbots provider (for MEV protection)
    this.flashbotsProvider = await FlashbotsBundleProvider.create(
      this.provider, 
      this.wallet, 
      'https://relay.flashbots.net'
    );
    
    console.log('Bot initialized. Starting to scan for opportunities...');
  }
  
  initializeDexes() {
    const dexes = {};
    
    for (const dex of config.supportedDexes) {
      dexes[dex.name] = {
        ...dex,
        // Initialize contracts based on dex type
        contracts: this.initializeDexContracts(dex)
      };
    }
    
    return dexes;
  }
  
  initializeDexContracts(dex) {
    const contracts = {};
    
    if (dex.name === 'Uniswap V3') {
      contracts.router = new ethers.Contract(
        dex.routerAddress,
        ['function exactInputSingle(tuple(address,address,uint24,address,uint256,uint256,uint256,uint160)) external returns (uint256)'],
        this.wallet
      );
      
      contracts.quoter = new ethers.Contract(
        '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6', // Uniswap V3 Quoter
        UNISWAP_V3_QUOTER_ABI,
        this.provider
      );
      
      contracts.factory = new ethers.Contract(
        dex.factoryAddress,
        ['function getPool(address,address,uint24) view returns (address)'],
        this.provider
      );
    } else if (dex.name === 'Curve') {
      contracts.registry = new ethers.Contract(
        '0x90E00ACe148ca3b23Ac1bC8C240C2a7Dd9c2d7f5', // Curve Registry
        ['function find_pool_for_coins(address,address) view returns (address)'],
        this.provider
      );
    } else if (dex.name === 'SushiSwap') {
      contracts.router = new ethers.Contract(
        dex.routerAddress,
        [
          'function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)',
          'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)'
        ],
        this.wallet
      );
      
      contracts.factory = new ethers.Contract(
        dex.factoryAddress,
        ['function getPair(address tokenA, address tokenB) view returns (address pair)'],
        this.provider
      );
    }
    
    return contracts;
  }
  
  initializeTokens() {
    const tokens = {};
    
    for (const token of config.tokens) {
      tokens[token.symbol] = {
        ...token,
        contract: new ethers.Contract(token.address, ERC20_ABI, this.wallet)
      };
    }
    
    return tokens;
  }
  
  initializeFlashLoanProviders() {
    const providers = {};
    
    if (config.flashLoanProviders.aave) {
      providers.aave = {
        ...config.flashLoanProviders.aave,
        lendingPool: new ethers.Contract(
          config.flashLoanProviders.aave.lendingPoolAddress,
          AAVE_LENDING_POOL_ABI,
          this.wallet
        )
      };
    }
    
    return providers;
  }
  
  initializeOracles() {
    const oracles = {};
    
    if (config.oracles.chainlink) {
      oracles.chainlink = {
        ...config.oracles.chainlink,
        ethUsdPriceFeed: new ethers.Contract(
          config.oracles.chainlink.ethUsdFeed,
          ['function latestAnswer() view returns (int256)'],
          this.provider
        ),
        btcUsdPriceFeed: new ethers.Contract(
          config.oracles.chainlink.btcUsdFeed,
          ['function latestAnswer() view returns (int256)'],
          this.provider
        )
      };
    }
    
    return oracles;
  }
  
  initializeExchanges() {
    // Initialize exchange API clients
    const exchanges = {};
    
    // Initialize Coinbase
    if (config.exchanges.coinbase.apiKey) {
      // Setup Coinbase client
      exchanges.coinbase = {
        name: 'Coinbase',
        getOrderBook: async (symbol) => {
          try {
            const response = await axios.get(`https://api.exchange.coinbase.com/products/${symbol}/book?level=2`, {
              headers: {
                'CB-ACCESS-KEY': config.exchanges.coinbase.apiKey,
                'CB-ACCESS-SIGN': '', // Signature would be calculated here
                'CB-ACCESS-TIMESTAMP': '',
              }
            });
            return response.data;
          } catch (error) {
            console.error(`Error fetching Coinbase orderbook for ${symbol}:`, error.message);
            return null;
          }
        }
      };
    }
    
    // Initialize Kraken
    if (config.exchanges.kraken.apiKey) {
      exchanges.kraken = {
        name: 'Kraken',
        getOrderBook: async (symbol) => {
          try {
            const response = await axios.post('https://api.kraken.com/0/private/Depth', {
              pair: symbol
            }, {
              headers: {
                'API-Key': config.exchanges.kraken.apiKey,
                'API-Sign': '' // Signature would be calculated here
              }
            });
            return response.data;
          } catch (error) {
            console.error(`Error fetching Kraken orderbook for ${symbol}:`, error.message);
            return null;
          }
        }
      };
    }
    
    // Initialize other exchanges similarly
    // ...
    
    return exchanges;
  }
  
  async startScanning() {
    console.log('Starting to scan for arbitrage opportunities...');
    
    while (true) {
      try {
        // 1. Scan for DEX arbitrage opportunities
        await this.scanDexArbitrageOpportunities();
        
        // 2. Scan for CEX-DEX arbitrage opportunities
        await this.scanCexDexArbitrageOpportunities();
        
        // Wait before next scan to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 5000));
      } catch (error) {
        console.error('Error in scanning loop:', error);
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
  }
  
  async scanDexArbitrageOpportunities() {
    console.log('Scanning for DEX arbitrage opportunities...');
    
    // Get current gas price
    const feeData = await this.provider.getFeeData();
    const gasPrice = feeData.gasPrice;
    const gasPriceGwei = parseFloat(ethers.formatUnits(gasPrice, 'gwei'));
    
    // Skip if gas price is too high
    if (gasPriceGwei > config.maxGasPrice) {
      console.log(`Gas price too high (${gasPriceGwei} gwei). Skipping scan.`);
      return;
    }
    
    // Get ETH price in USD for calculations
    const ethPrice = await this.getEthPriceUsd();
    
    // For each token pair, check for arbitrage across DEXes
    for (let i = 0; i < config.tokens.length; i++) {
      for (let j = i + 1; j < config.tokens.length; j++) {
        const tokenA = config.tokens[i];
        const tokenB = config.tokens[j];
        
        // Estimate required flash loan amount
        const flashLoanAmount = ethers.parseUnits('10000', tokenA.decimals); // Example amount
        
        // Check for arbitrage opportunities
        const opportunity = await this.checkDexArbitrage(tokenA, tokenB, flashLoanAmount, ethPrice, gasPrice);
        
        if (opportunity && opportunity.profitUsd > config.minProfitUsd) {
          console.log(`Found profitable arbitrage opportunity: ${JSON.stringify(opportunity)}`);
          
          // Execute the arbitrage if auto-execution is enabled
          await this.executeArbitrage(opportunity);
        }
      }
    }
  }
  
  async scanCexDexArbitrageOpportunities() {
    console.log('Scanning for CEX-DEX arbitrage opportunities...');
    
    // Common trading pairs to check
    const pairs = [
      { base: 'ETH', quote: 'USDT' },
      { base: 'BTC', quote: 'USDT' },
      { base: 'ETH', quote: 'USDC' },
      { base: 'BTC', quote: 'USDC' },
    ];
    
    for (const pair of pairs) {
      // Get best prices from DEXes
      const dexBid = await this.getBestDexBid(pair.base, pair.quote);
      const dexAsk = await this.getBestDexAsk(pair.base, pair.quote);
      
      // Check each CEX
      for (const [exchangeName, exchange] of Object.entries(this.exchanges)) {
        try {
          // Get orderbook from exchange
          const orderbook = await exchange.getOrderBook(`${pair.base}-${pair.quote}`);
          if (!orderbook) continue;
          
          // Extract best bid and ask
          const cexBid = parseFloat(orderbook.bids[0][0]);
          const cexAsk = parseFloat(orderbook.asks[0][0]);
          
          // Check for CEX->DEX arbitrage
          if (cexBid > dexAsk) {
            const spreadPercentage = ((cexBid / dexAsk) - 1) * 100;
            console.log(`Potential arbitrage: Buy on DEX at ${dexAsk}, sell on ${exchangeName} at ${cexBid}. Spread: ${spreadPercentage.toFixed(2)}%`);
            
            // Calculate profitability
            // ... (accounting for fees, slippage, etc.)
          }
          
          // Check for DEX->CEX arbitrage
          if (dexBid > cexAsk) {
            const spreadPercentage = ((dexBid / cexAsk) - 1) * 100;
            console.log(`Potential arbitrage: Buy on ${exchangeName} at ${cexAsk}, sell on DEX at ${dexBid}. Spread: ${spreadPercentage.toFixed(2)}%`);
            
            // Calculate profitability
            // ... (accounting for fees, slippage, etc.)
          }
        } catch (error) {
          console.error(`Error checking CEX arbitrage with ${exchangeName}:`, error.message);
        }
      }
    }
  }
  
  async checkDexArbitrage(tokenA, tokenB, amount, ethPrice, gasPrice) {
    // Get quotes from different DEXes
    const quotes = await this.getQuotesForPair(tokenA, tokenB, amount);
    
    // Find best buy and sell prices
    let bestBuyDex = null;
    let bestBuyPrice = ethers.ZeroHash;
    let bestSellDex = null;
    let bestSellPrice = ethers.MaxUint256;
    
    for (const [dexName, quote] of Object.entries(quotes)) {
      // Best place to buy tokenB with tokenA
      if (quote.buyAmount > bestBuyPrice) {
        bestBuyPrice = quote.buyAmount;
        bestBuyDex = dexName;
      }
      
      // Best place to sell tokenB for tokenA
      if (quote.sellAmount < bestSellPrice) {
        bestSellPrice = quote.sellAmount;
        bestSellDex = dexName;
      }
    }
    
    // Check if there's an arbitrage opportunity
    if (bestBuyDex && bestSellDex && bestBuyDex !== bestSellDex) {
      // Calculate potential profit
      const buyAmount = bestBuyPrice;
      const sellAmount = quotes[bestSellDex].sellAmount;
      
      if (buyAmount > sellAmount) {
        // There's a potential profit, calculate it
        const rawProfit = buyAmount - sellAmount;
        
        // Estimate gas cost
        const estimatedGasLimit = ethers.getBigInt(500000); // Estimate
        const gasCostWei = gasPrice * estimatedGasLimit;
        const gasCostEth = ethers.formatEther(gasCostWei);
        const gasCostUsd = parseFloat(gasCostEth) * ethPrice;
        
        // Calculate flash loan fee
        const flashLoanFeePercent = this.flashLoanProviders.aave.fee;
        const flashLoanFeeAmount = (amount * ethers.getBigInt(Math.floor(flashLoanFeePercent * 100))) / 10000n;
        
        // Convert profit to USD for easier comparison
        // This would require getting the token price in USD
        const profitUsd = 0; // Placeholder - would calculate actual USD value
        
        // Account for DEX fees and slippage
        const dexFees = 0; // Placeholder - would calculate based on DEX fee rates
        
        // Total costs
        const totalCostsUsd = gasCostUsd + dexFees;
        
        // Net profit
        const netProfitUsd = profitUsd - totalCostsUsd;
        
        return {
          tokenA: tokenA.symbol,
          tokenB: tokenB.symbol,
          buyDex: bestBuyDex,
          sellDex: bestSellDex,
          amount: ethers.formatUnits(amount, tokenA.decimals),
          buyAmount: ethers.formatUnits(buyAmount, tokenB.decimals),
          sellAmount: ethers.formatUnits(sellAmount, tokenA.decimals),
          rawProfit: ethers.formatUnits(rawProfit, tokenA.decimals),
          gasCostEth,
          gasCostUsd,
          flashLoanFee: ethers.formatUnits(flashLoanFeeAmount, tokenA.decimals),
          profitUsd,
          netProfitUsd
        };
      }
    }
    
    return null; // No profitable arbitrage found
  }
  
  async getQuotesForPair(tokenA, tokenB, amount) {
    const quotes = {};
    
    for (const [dexName, dex] of Object.entries(this.dexes)) {
      try {
        if (dexName === 'Uniswap V3') {
          // Get quote from Uniswap V3
          const buyAmount = await dex.contracts.quoter.quoteExactInputSingle.staticCall(
            tokenA.address,
            tokenB.address,
            3000, // Fee tier (0.3%)
            amount,
            0 // No price limit
          );
          
          const sellAmount = await dex.contracts.quoter.quoteExactInputSingle.staticCall(
            tokenB.address,
            tokenA.address,
            3000, // Fee tier (0.3%)
            buyAmount,
            0 // No price limit
          );
          
          quotes[dexName] = { buyAmount, sellAmount };
        } 
        else if (dexName === 'Curve') {
          // Find the Curve pool for this pair
          const poolAddress = await dex.contracts.registry.find_pool_for_coins(tokenA.address, tokenB.address);
          
          if (poolAddress && poolAddress !== ethers.ZeroAddress) {
            const pool = new ethers.Contract(poolAddress, CURVE_POOL_ABI, this.provider);
            
            // Get token indices in the pool
            const tokenAIndex = 0; // This would need to be determined dynamically
            const tokenBIndex = 1; // This would need to be determined dynamically
            
            // Get quotes
            const buyAmount = await pool.get_dy(tokenAIndex, tokenBIndex, amount);
            const sellAmount = await pool.get_dy(tokenBIndex, tokenAIndex, buyAmount);
            
            quotes[dexName] = { buyAmount, sellAmount };
          }
        }
        else if (dexName === 'SushiSwap') {
          // Get quote from SushiSwap
          const buyPath = [tokenA.address, tokenB.address];
          const sellPath = [tokenB.address, tokenA.address];
          
          const buyAmounts = await dex.contracts.router.getAmountsOut(amount, buyPath);
          const buyAmount = buyAmounts[1];
          
          const sellAmounts = await dex.contracts.router.getAmountsOut(buyAmount, sellPath);
          const sellAmount = sellAmounts[1];
          
          quotes[dexName] = { buyAmount, sellAmount };
        }
      } catch (error) {
        console.error(`Error getting quotes from ${dexName}:`, error.message);
      }
    }
    
    return quotes;
  }
  
  async executeArbitrage(opportunity) {
    console.log(`Executing arbitrage: ${JSON.stringify(opportunity)}`);
    
    // 1. Get token contracts
    const tokenA = this.tokens[opportunity.tokenA].contract;
    const tokenB = this.tokens[opportunity.tokenB].contract;
    
    // 2. Create flash loan contract instance (would be deployed separately)
    const flashLoanContract = {
      address: process.env.FLASH_LOAN_CONTRACT_ADDRESS
    };
    
    // 3. Approve flash loan contract to spend tokens
    await tokenA.approve(flashLoanContract.address, ethers.MaxUint256);
    await tokenB.approve(flashLoanContract.address, ethers.MaxUint256);
    
    // 4. Execute flash loan
    const lendingPool = this.flashLoanProviders.aave.lendingPool;
    const flashLoanAmount = ethers.parseUnits(opportunity.amount, this.tokens[opportunity.tokenA].decimals);
    
    // Encode parameters for the flash loan callback
    const params = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'string', 'string'],
      [
        this.tokens[opportunity.tokenA].address,
        this.tokens[opportunity.tokenB].address,
        opportunity.buyDex,
        opportunity.sellDex
      ]
    );
    
    try {
      // Execute the flash loan transaction
      const tx = await lendingPool.flashLoan(
        flashLoanContract.address,
        [this.tokens[opportunity.tokenA].address],
        [flashLoanAmount],
        [0], // 0 = no debt, 1 = stable, 2 = variable
        flashLoanContract.address,
        params,
        0 // referral code
      );
      
      console.log(`Flash loan transaction submitted: ${tx.hash}`);
      
      // Wait for transaction confirmation
      const receipt = await tx.wait();
      console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
      
      // Check for successful arbitrage from events
      // ...
      
      return {
        success: true,
        txHash: tx.hash
      };
    } catch (error) {
      console.error('Error executing arbitrage:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  async getEthPriceUsd() {
    try {
      const priceBN = await this.oracles.chainlink.ethUsdPriceFeed.latestAnswer();
      // Chainlink price feeds typically have 8 decimals
      return parseFloat(ethers.formatUnits(priceBN, 8));
    } catch (error) {
      console.error('Error getting ETH price:', error.message);
      // Fallback to a default price or fetch from an API
      return 2000; // Example fallback price
    }
  }
  
  async getBestDexBid(baseToken, quoteToken) {
    // Implementation to get the best bid price across DEXes
    // ...
    return 0; // Placeholder
  }
  
  async getBestDexAsk(baseToken, quoteToken) {
    // Implementation to get the best ask price across DEXes
    // ...
    return 0; // Placeholder
  }
}

module.exports = { ArbitrageBot };