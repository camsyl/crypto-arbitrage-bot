// src/bot/EnhancedArbitrageBot.js
const { ethers } = require('ethers');
const { FlashbotsBundleProvider } = require('@flashbots/ethers-provider-bundle');
const ValidationManager = require('../utils/ValidationManager');
const LiquidityValidator = require('../utils/LiquidityValidator');
const PriceValidator = require('../utils/PriceValidator');
const { MultiPathArbitrageStrategy } = require('./MultiPathArbitrageStrategy');
const axios = require('axios');
require('dotenv').config();

/**
 * Enhanced Arbitrage Bot with comprehensive validation and safety features
 */
class EnhancedArbitrageBot {
  constructor(provider, config) {
    this.provider = provider;
    this.config = config;
    this.wallet = new ethers.Wallet(config.privateKey, provider);
    
    // Initialize validation manager
    this.validationManager = new ValidationManager(provider, config);
    
    // Initialize strategy
    this.multiPathStrategy = new MultiPathArbitrageStrategy(provider, config);
    
    // Bot state
    this.isScanning = false;
    this.scanIntervalMs = 5000; // 5 second interval
    this.executionLock = false; // Prevent concurrent executions
    
    // Stats and metrics
    this.stats = {
      opportunities: { total: 0, valid: 0, invalid: 0, executed: 0 },
      transactions: { submitted: 0, confirmed: 0, failed: 0 },
      profits: { totalUsd: 0, highestUsd: 0, lastUsd: 0 }
    };
    
    this.dexes = this._initializeDexes();
    this.tokens = this._initializeTokens();
    this.flashLoanProviders = this._initializeFlashLoanProviders();
  }
  
  /**
   * Initialize the bot with required connections
   */
  async initialize() {
    console.log('Initializing Enhanced Arbitrage Bot...');
    
    // Set up Flashbots provider for MEV protection
    this.flashbotsProvider = await FlashbotsBundleProvider.create(
      this.provider,
      this.wallet,
      'https://relay.flashbots.net'
    );
    
    // Set initial market conditions
    this.validationManager.setMarketConditions('normal', 'medium');
    
    console.log('Enhanced Arbitrage Bot initialized successfully');
    
    return this;
  }
  
  /**
   * Start scanning for arbitrage opportunities
   */
  async startScanning() {
    if (this.isScanning) {
      console.log('Bot is already scanning');
      return;
    }
    
    console.log('Starting to scan for arbitrage opportunities...');
    this.isScanning = true;
    
    // Main scanning loop
    while (this.isScanning) {
      try {
        // Update market conditions based on external data
        await this._updateMarketConditions();
        
        // 1. Scan for DEX arbitrage opportunities
        await this._scanDexArbitrageOpportunities();
        
        // 2. Scan for multi-path arbitrage opportunities
        await this._scanMultiPathOpportunities();
        
        // 3. Scan for CEX-DEX arbitrage opportunities (if enabled)
        if (this.config.enableCexDexArbitrage) {
          await this._scanCexDexArbitrageOpportunities();
        }
        
        // Wait before next scan to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, this.scanIntervalMs));
      } catch (error) {
        console.error('Error in scanning loop:', error);
        await new Promise(resolve => setTimeout(resolve, 10000)); // Longer wait on error
      }
    }
  }
  
  /**
   * Stop scanning for opportunities
   */
  stopScanning() {
    console.log('Stopping arbitrage scanner...');
    this.isScanning = false;
  }
  
  /**
   * Initialize DEX interfaces
   * @private
   */
  _initializeDexes() {
    const dexes = {};
    
    for (const dex of this.config.supportedDexes) {
      dexes[dex.name] = {
        ...dex,
        contracts: this._initializeDexContracts(dex)
      };
    }
    
    return dexes;
  }
  
  /**
   * Initialize contracts for specific DEX
   * @private
   */
  _initializeDexContracts(dex) {
    // This is similar to what you already have in ArbitrageBot.js
    // Implementing just the core functionality here
    const contracts = {};
    
    if (dex.name === 'Uniswap V3') {
      contracts.router = new ethers.Contract(
        dex.routerAddress,
        ['function exactInputSingle(tuple(address,address,uint24,address,uint256,uint256,uint256,uint160)) external returns (uint256)'],
        this.wallet
      );
      
      contracts.quoter = new ethers.Contract(
        '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6', // Uniswap V3 Quoter
        ['function quoteExactInputSingle(address,address,uint24,uint256,uint160) external returns (uint256)'],
        this.provider
      );
    } else if (dex.name === 'SushiSwap') {
      contracts.router = new ethers.Contract(
        dex.routerAddress,
        [
          'function getAmountsOut(uint,address[]) view returns (uint[])',
          'function swapExactTokensForTokens(uint,uint,address[],address,uint) external returns (uint[])'
        ],
        this.wallet
      );
    }
    
    return contracts;
  }
  
  /**
   * Initialize token contracts
   * @private
   */
  _initializeTokens() {
    const tokens = {};
    const ERC20_ABI = [
      'function balanceOf(address) view returns (uint256)',
      'function approve(address,uint256) returns (bool)',
      'function decimals() view returns (uint8)'
    ];
    
    for (const token of this.config.tokens) {
      tokens[token.symbol] = {
        ...token,
        contract: new ethers.Contract(token.address, ERC20_ABI, this.wallet)
      };
    }
    
    return tokens;
  }
  
  /**
   * Initialize flash loan providers
   * @private
   */
  _initializeFlashLoanProviders() {
    const providers = {};
    
    if (this.config.flashLoanProviders.aave) {
      providers.aave = {
        ...this.config.flashLoanProviders.aave,
        lendingPool: new ethers.Contract(
          this.config.flashLoanProviders.aave.lendingPoolAddress,
          ['function flashLoan(address,address[],uint256[],uint256[],address,bytes,uint16) external'],
          this.wallet
        )
      };
    }
    
    return providers;
  }
  
  /**
   * Update market conditions based on external data
   * @private
   */
  async _updateMarketConditions() {
    try {
      // In a real implementation, you would:
      // 1. Get volatility metrics from an API
      // 2. Get risk metrics from your risk management system
      // 3. Adjust validation parameters based on current conditions
      
      // For this example, we'll just keep it at "normal" and "medium"
      // this.validationManager.setMarketConditions('normal', 'medium');
    } catch (error) {
      console.error('Error updating market conditions:', error.message);
    }
  }
  
  /**
   * Scan for arbitrage opportunities between DEXes
   * @private
   */
  async _scanDexArbitrageOpportunities() {
    console.log('Scanning for DEX arbitrage opportunities...');
    
    // Get current gas price to filter opportunities
    const feeData = await this.provider.getFeeData();
    const gasPrice = feeData.gasPrice;
    const gasPriceGwei = parseFloat(ethers.formatUnits(gasPrice, 'gwei'));
    
    // Skip if gas price is too high
    if (gasPriceGwei > this.config.maxGasPrice) {
      console.log(`Gas price too high (${gasPriceGwei} gwei). Skipping scan.`);
      return;
    }
    
    // Check token pairs for arbitrage opportunities
    for (let i = 0; i < this.config.tokens.length; i++) {
      for (let j = i + 1; j < this.config.tokens.length; j++) {
        const tokenA = this.config.tokens[i];
        const tokenB = this.config.tokens[j];
        
        // For each token pair, check for arbitrage across DEXes
        for (const amountStr of this._getTestAmounts(tokenA.symbol)) {
          const amountIn = amountStr;
          
          // Find arbitrage opportunities
          const opportunity = await this._findArbitrageOpportunity(
            tokenA.symbol,
            tokenB.symbol,
            amountIn
          );
          
          if (opportunity) {
            // Increment stats
            this.stats.opportunities.total++;
            
            // Validate the opportunity through the validation manager
            const validation = await this.validationManager.validateOpportunity(opportunity);
            
            if (validation.isValid) {
              console.log(`✅ Valid arbitrage opportunity found: ${tokenA.symbol}/${tokenB.symbol}`);
              console.log(`   Buy on ${opportunity.buyDex}, sell on ${opportunity.sellDex}`);
              console.log(`   Amount: ${amountIn} ${tokenA.symbol}`);
              console.log(`   Expected profit: $${validation.details.netProfitUsd.toFixed(2)}`);
              
              this.stats.opportunities.valid++;
              
              // Execute if auto-execution is enabled
              if (this.config.autoExecute && !this.executionLock) {
                await this._executeArbitrage(opportunity);
              } else {
                console.log('Auto-execution disabled or execution locked. Skipping trade.');
              }
            } else {
              console.log(`❌ Invalid arbitrage opportunity: ${tokenA.symbol}/${tokenB.symbol}`);
              console.log(`   Reason: ${validation.details.reason}`);
              this.stats.opportunities.invalid++;
            }
          }
        }
      }
    }
  }
  
  /**
   * Get test amounts for a specific token
   * @param {string} symbol - Token symbol
   * @returns {string[]} - Array of test amounts
   * @private
   */
  _getTestAmounts(symbol) {
    // Scale amounts based on token type
    if (symbol === 'WETH') {
      return ['0.1', '1', '5', '10'];
    } else if (symbol === 'WBTC') {
      return ['0.01', '0.1', '0.5', '1'];
    } else if (['USDC', 'USDT', 'DAI'].includes(symbol)) {
      return ['100', '1000', '5000', '10000'];
    } else {
      return ['10', '100', '1000'];
    }
  }
  
  /**
   * Find arbitrage opportunity between token pair
   * @param {string} tokenASymbol - First token symbol
   * @param {string} tokenBSymbol - Second token symbol
   * @param {string} amountInStr - Input amount as string
   * @returns {Promise<Object|null>} - Arbitrage opportunity or null
   * @private
   */
  async _findArbitrageOpportunity(tokenASymbol, tokenBSymbol, amountInStr) {
    try {
      const tokenA = this.config.tokens.find(t => t.symbol === tokenASymbol);
      const tokenB = this.config.tokens.find(t => t.symbol === tokenBSymbol);
      
      if (!tokenA || !tokenB) {
        return null;
      }
      
      const amountIn = ethers.parseUnits(amountInStr, tokenA.decimals);
      
      // Get quotes from all supported DEXes
      const quotes = await this._getDexQuotes(tokenA, tokenB, amountIn);
      
      // Find best buy and sell prices
      let bestBuyDex = null;
      let bestBuyAmount = 0n;
      let bestSellDex = null;
      let bestSellAmount = 0n;
      
      // Find best places to buy and sell
      for (const [dexName, quote] of Object.entries(quotes)) {
        if (quote.buyAmount > bestBuyAmount) {
          bestBuyAmount = quote.buyAmount;
          bestBuyDex = dexName;
        }
        
        // For selling, we need a different approach than in your original code
        // Here, we're looking for the DEX that gives the most tokenA back for tokenB
        // We'll simulate this by using the reverse quotes
        if (quote.sellAmount > bestSellAmount) {
          bestSellAmount = quote.sellAmount;
          bestSellDex = dexName;
        }
      }
      
      // If we found potential arbitrage
      if (bestBuyDex && bestSellDex && bestBuyDex !== bestSellDex) {
        // Calculate expected profit in tokenA
        const buyAmount = bestBuyAmount;
        
        // Now calculate how much tokenA we'd get back if we sold the buyAmount on the sell DEX
        const sellQuote = await this._getSellQuote(bestSellDex, tokenB, tokenA, buyAmount);
        
        if (sellQuote > amountIn) {
          // Potential profit exists
          const rawProfit = sellQuote - amountIn;
          
          // Format for readability and calculate USD values
          const rawProfitFormatted = ethers.formatUnits(rawProfit, tokenA.decimals);
          
          // Convert to USD (simplified - you'd use a price oracle)
          const tokenPriceUsd = await this.validationManager.getTokenPriceUsd(tokenA.symbol);
          const profitUsd = parseFloat(rawProfitFormatted) * tokenPriceUsd;
          
          return {
            tokenA: tokenASymbol,
            tokenB: tokenBSymbol,
            buyDex: bestBuyDex,
            sellDex: bestSellDex,
            amountIn: amountInStr,
            buyAmount: ethers.formatUnits(buyAmount, tokenB.decimals),
            sellAmount: ethers.formatUnits(sellQuote, tokenA.decimals),
            rawProfit: rawProfitFormatted,
            profitUsd,
            tokenAAddress: tokenA.address,
            tokenBAddress: tokenB.address,
            spreadPercentage: (profitUsd / (parseFloat(amountInStr) * tokenPriceUsd)) * 100
          };
        }
      }
      
      return null; // No profitable arbitrage found
    } catch (error) {
      console.error(`Error finding arbitrage for ${tokenASymbol}/${tokenBSymbol}:`, error.message);
      return null;
    }
  }
  
  /**
   * Get quotes from all DEXes for a token pair
   * @param {Object} tokenA - First token info
   * @param {Object} tokenB - Second token info
   * @param {BigNumber} amountIn - Input amount
   * @returns {Promise<Object>} - Map of DEX names to quotes
   * @private
   */
  async _getDexQuotes(tokenA, tokenB, amountIn) {
    const quotes = {};
    
    for (const [dexName, dex] of Object.entries(this.dexes)) {
      try {
        if (dexName === 'Uniswap V3') {
          // Get quotes for all fee tiers and use the best one
          const feeTiers = [100, 500, 3000, 10000]; // 0.01%, 0.05%, 0.3%, 1%
          let bestBuyAmount = 0n;
          let bestSellAmount = 0n;
          
          for (const feeTier of feeTiers) {
            try {
              // Buy quote (A to B)
              const buyAmount = await dex.contracts.quoter.quoteExactInputSingle.staticCall(
                tokenA.address,
                tokenB.address,
                feeTier,
                amountIn,
                0
              );
              
              if (buyAmount > bestBuyAmount) {
                bestBuyAmount = buyAmount;
              }
              
              // Get the sell amount (how much A you'd get back for buyAmount of B)
              // This is a simplification - in production you'd handle this better
              const sellAmount = await dex.contracts.quoter.quoteExactInputSingle.staticCall(
                tokenB.address,
                tokenA.address,
                feeTier,
                bestBuyAmount, // Use the best buy amount
                0
              );
              
              if (sellAmount > bestSellAmount) {
                bestSellAmount = sellAmount;
              }
            } catch (error) {
              // Skip this fee tier if there's an error
            }
          }
          
          if (bestBuyAmount > 0n) {
            quotes[dexName] = { buyAmount: bestBuyAmount, sellAmount: bestSellAmount };
          }
        } else if (dexName === 'SushiSwap') {
          try {
            // Buy path (A to B)
            const buyPath = [tokenA.address, tokenB.address];
            const buyAmounts = await dex.contracts.router.getAmountsOut(amountIn, buyPath);
            const buyAmount = buyAmounts[1];
            
            // Sell path (B to A) - how much A you'd get for buyAmount of B
            const sellPath = [tokenB.address, tokenA.address];
            const sellAmounts = await dex.contracts.router.getAmountsOut(buyAmount, sellPath);
            const sellAmount = sellAmounts[1];
            
            quotes[dexName] = { buyAmount, sellAmount };
          } catch (error) {
            // Skip if there's an error
          }
        }
        // Add other DEXes as needed
      } catch (error) {
        console.error(`Error getting quotes from ${dexName}:`, error.message);
      }
    }
    
    return quotes;
  }
  
  /**
   * Get sell quote for a specific DEX
   * @param {string} dexName - DEX name
   * @param {Object} tokenIn - Input token info
   * @param {Object} tokenOut - Output token info
   * @param {BigNumber} amountIn - Input amount
   * @returns {Promise<BigNumber>} - Expected output amount
   * @private
   */
  async _getSellQuote(dexName, tokenIn, tokenOut, amountIn) {
    try {
      const dex = this.dexes[dexName];
      
      if (!dex) {
        throw new Error(`DEX ${dexName} not configured`);
      }
      
      if (dexName === 'Uniswap V3') {
        // Get quotes for all fee tiers and use the best one
        const feeTiers = [100, 500, 3000, 10000]; // 0.01%, 0.05%, 0.3%, 1%
        let bestOutput = 0n;
        
        for (const feeTier of feeTiers) {
          try {
            const output = await dex.contracts.quoter.quoteExactInputSingle.staticCall(
              tokenIn.address,
              tokenOut.address,
              feeTier,
              amountIn,
              0
            );
            
            if (output > bestOutput) {
              bestOutput = output;
            }
          } catch (error) {
            // Skip this fee tier if there's an error
          }
        }
        
        return bestOutput;
      } else if (dexName === 'SushiSwap') {
        const path = [tokenIn.address, tokenOut.address];
        const outputs = await dex.contracts.router.getAmountsOut(amountIn, path);
        return outputs[1];
      }
      
      return 0n; // Default return if no quote found
    } catch (error) {
      console.error(`Error getting sell quote from ${dexName}:`, error.message);
      return 0n;
    }
  }
  
  /**
   * Execute an arbitrage opportunity
   * @param {Object} opportunity - The arbitrage opportunity
   * @returns {Promise<Object>} - Transaction result
   * @private
   */
  async _executeArbitrage(opportunity) {
    if (this.executionLock) {
      console.log('Execution locked. Skipping trade.');
      return { success: false, reason: 'Execution locked' };
    }
    
    try {
      // Set execution lock to prevent concurrent trades
      this.executionLock = true;
      
      console.log(`\n🚀 EXECUTING ARBITRAGE`);
      console.log(`   Tokens: ${opportunity.tokenA}/${opportunity.tokenB}`);
      console.log(`   Buy on ${opportunity.buyDex}, sell on ${opportunity.sellDex}`);
      console.log(`   Amount: ${opportunity.amountIn} ${opportunity.tokenA}`);
      console.log(`   Expected profit: ${opportunity.profitUsd.toFixed(2)}`);
      
      // Get contract info
      const tokenA = this.tokens[opportunity.tokenA];
      const tokenB = this.tokens[opportunity.tokenB];
      
      // Get contract instance for arbitrage contract
      const flashLoanContractAddress = this.config.flashLoanContractAddress;
      if (!flashLoanContractAddress) {
        throw new Error('Flash loan contract address not configured');
      }
      
      const flashLoanContract = new ethers.Contract(
        flashLoanContractAddress,
        [
          'function executeArbitrage(address,address,uint256,uint8,uint8,address,address,uint256) external'
        ],
        this.wallet
      );
      
      // Convert DEX names to enum values
      const buyDexEnum = this._getDexEnum(opportunity.buyDex);
      const sellDexEnum = this._getDexEnum(opportunity.sellDex);
      
      // Parse amount in
      const amountIn = ethers.parseUnits(opportunity.amountIn, tokenA.decimals);
      
      // Calculate minimum profit (e.g., 80% of expected profit)
      const expectedProfit = ethers.parseUnits(opportunity.rawProfit, tokenA.decimals);
      const minProfitAmount = expectedProfit * 80n / 100n; // 80% of expected profit
      
      // Prepare transaction parameters
      const tx = await flashLoanContract.executeArbitrage(
        tokenA.address,
        tokenB.address,
        amountIn,
        buyDexEnum,
        sellDexEnum,
        ethers.ZeroAddress, // curvePoolForBuy (not used here)
        ethers.ZeroAddress, // curvePoolForSell (not used here)
        minProfitAmount,
        {
          gasLimit: 1000000,
          maxFeePerGas: await this._getOptimalGasPrice()
        }
      );
      
      console.log(`Transaction submitted: ${tx.hash}`);
      this.stats.transactions.submitted++;
      
      // Wait for confirmation
      const receipt = await tx.wait();
      console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
      this.stats.transactions.confirmed++;
      
      // Process transaction events
      let profit = 0n;
      let success = false;
      
      for (const log of receipt.logs) {
        try {
          // Try to parse as ArbitrageExecuted event
          const parsedLog = flashLoanContract.interface.parseLog({
            topics: log.topics,
            data: log.data
          });
          
          if (parsedLog && parsedLog.name === 'ArbitrageExecuted') {
            profit = parsedLog.args.profit;
            success = true;
            
            // Update stats
            const profitUsd = Number(ethers.formatUnits(profit, tokenA.decimals)) * 
                            await this.validationManager.getTokenPriceUsd(opportunity.tokenA);
            
            this.stats.profits.totalUsd += profitUsd;
            this.stats.profits.lastUsd = profitUsd;
            this.stats.profits.highestUsd = Math.max(this.stats.profits.highestUsd, profitUsd);
            this.stats.opportunities.executed++;
            
            console.log(`✅ Arbitrage successful!`);
            console.log(`   Profit: ${ethers.formatUnits(profit, tokenA.decimals)} ${opportunity.tokenA}`);
            console.log(`   Profit in USD: ${profitUsd.toFixed(2)}`);
          }
        } catch (error) {
          // Not our event or error parsing
        }
      }
      
      if (!success) {
        this.stats.transactions.failed++;
        console.log(`❌ Arbitrage execution failed: Transaction confirmed but no success event found`);
      }
      
      return { 
        success, 
        txHash: tx.hash, 
        blockNumber: receipt.blockNumber,
        profit: profit ? ethers.formatUnits(profit, tokenA.decimals) : '0'
      };
      
    } catch (error) {
      console.error('Error executing arbitrage:', error);
      this.stats.transactions.failed++;
      
      return { 
        success: false, 
        error: error.message 
      };
    } finally {
      // Release execution lock after a delay
      setTimeout(() => {
        this.executionLock = false;
      }, 5000); // 5 second delay
    }
  }
  
  /**
   * Get enum value for DEX name
   * @param {string} dexName - DEX name
   * @returns {number} - Enum value
   * @private
   */
  _getDexEnum(dexName) {
    const dexEnums = {
      'Uniswap V3': 0,
      'SushiSwap': 1,
      'Curve': 2
    };
    
    return dexEnums[dexName] || 0;
  }
  
  /**
   * Get optimal gas price for transaction
   * @returns {Promise<BigNumber>} - Gas price in wei
   * @private
   */
  async _getOptimalGasPrice() {
    const feeData = await this.provider.getFeeData();
    
    // Base fee + priority fee
    const baseGasPrice = feeData.gasPrice;
    const priorityFeeWei = ethers.parseUnits(
      this.config.priorityFee.toString(),
      'gwei'
    );
    
    return baseGasPrice + priorityFeeWei;
  }
  
  /**
   * Scan for multi-path arbitrage opportunities
   * @returns {Promise<void>}
   * @private
   */
  async _scanMultiPathOpportunities() {
    if (!this.config.enableMultiPathArbitrage) {
      return;
    }
    
    console.log('Scanning for multi-path arbitrage opportunities...');
    
    // Start with major tokens
    const startTokens = ['WETH', 'USDC', 'DAI', 'WBTC'];
    
    for (const tokenSymbol of startTokens) {
      const token = this.config.tokens.find(t => t.symbol === tokenSymbol);
      if (!token) continue;
      
      // Try different amounts
      for (const amountStr of this._getTestAmounts(tokenSymbol)) {
        const amount = ethers.parseUnits(amountStr, token.decimals);
        
        // Find best path
        const path = await this.multiPathStrategy.findArbitragePath(
          token.address,
          amount,
          4 // Max path length
        );
        
        if (path && path.profit > 0n) {
          // Found a potentially profitable path
          const profitability = await this.multiPathStrategy.isProfitable(path);
          
          if (profitability.profitable) {
            console.log(`✅ Found profitable multi-path opportunity:`);
            
            // Format path for display
            const pathSymbols = path.path.map(address => {
              const token = this.config.tokens.find(t => t.address.toLowerCase() === address.toLowerCase());
              return token ? token.symbol : address.substring(0, 8);
            });
            
            console.log(`   Path: ${pathSymbols.join(' → ')}`);
            console.log(`   Start amount: ${amountStr} ${tokenSymbol}`);
            console.log(`   Expected profit: ${ethers.formatUnits(path.profit, token.decimals)} ${tokenSymbol}`);
            console.log(`   Profit USD: ${profitability.profitUsd.toFixed(2)}`);
            
            // Execute if auto-execution is enabled
            if (this.config.autoExecute && !this.executionLock && 
                this.config.multiPathContractAddress) {
              // Execute multi-path arbitrage (implementation not shown for brevity)
              // await this.multiPathStrategy.executeMultiPathArbitrage(path, this.config.multiPathContractAddress);
              console.log('Multi-path execution disabled in this example');
            }
          } else {
            console.log(`❌ Found unprofitable multi-path: ${tokenSymbol}`);
            console.log(`   Reason: ${profitability.reason}`);
          }
        }
      }
    }
  }
  
  /**
   * Scan for CEX-DEX arbitrage opportunities
   * @returns {Promise<void>}
   * @private
   */
  async _scanCexDexArbitrageOpportunities() {
    // Implementation left out for brevity
    // This would be similar to your original code
  }
  
  /**
   * Get stats for the bot
   * @returns {Object} - Stats object
   */
  getStats() {
    return {
      ...this.stats,
      isScanning: this.isScanning,
      executionLock: this.executionLock,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = { EnhancedArbitrageBot };