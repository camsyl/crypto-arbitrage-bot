// src/bot/BotMonitoringIntegration.js
const { EnhancedArbitrageBot } = require('./EnhancedArbitrageBot');
const MonitoringService = require('../monitoring/MonitoringService');
const CircuitBreakerManager = require('../risk/CircuitBreakerManager');
const config = require('config');
const { ethers } = require('ethers');

/**
 * Integrates the EnhancedArbitrageBot with monitoring and circuit breaker systems
 */
class BotMonitoringIntegration {
  constructor(provider, signer) {
    this.provider = provider;
    this.signer = signer;
    this.bot = null;
    this.isRunning = false;
    this.executionEnabled = config.get('bot.executionEnabled') || false;
    this.maxTestAmount = config.has('testing.maxTestAmountETH') ? 
                         ethers.parseEther(config.get('testing.maxTestAmountETH')) : 
                         ethers.parseEther('0.1');
  }

  async initialize(contractAddress) {
    // Create bot configuration from config
    const botConfig = {
      privateKey: this.signer.privateKey,
      contractAddress: contractAddress,
      ...this._buildBotConfig()
    };

    // Initialize the enhanced arbitrage bot
    this.bot = new EnhancedArbitrageBot(this.provider, botConfig);
    await this.bot.initialize();
    
    // Set bot execution mode
    this.bot.setExecutionEnabled(this.executionEnabled);
    this.bot.setMaxTestAmount(this.maxTestAmount);
    
    // Add event handlers for monitoring
    this._setupEventHandlers();
    
    console.log(`Bot initialized with contract: ${contractAddress}`);
    console.log(`Execution enabled: ${this.executionEnabled}`);
    if (this.executionEnabled) {
      console.log(`Max test amount: ${ethers.formatEther(this.maxTestAmount)} ETH`);
    }
    
    // Initial heartbeat
    await MonitoringService.info('Bot initialized', {
      contractAddress,
      executionEnabled: this.executionEnabled,
      maxTestAmount: this.executionEnabled ? ethers.formatEther(this.maxTestAmount) : '0',
      network: await this.provider.getNetwork().then(n => n.name)
    });
    
    return this;
  }
  
  _buildBotConfig() {
    // Build configuration for bot from config files
    const networkName = config.get('network') || 'mainnet';
    const networkConfig = config.get(networkName);
    
    return {
      lendingPoolAddressesProvider: networkConfig.lendingPoolAddressesProvider,
      flashLoanProviders: {
        aave: {
          lendingPoolAddress: networkConfig.flashLoanProviders?.aave?.lendingPoolAddress,
          fee: networkConfig.flashLoanProviders?.aave?.fee || 0.09,
        }
      },
      supportedDexes: [
        {
          name: 'Uniswap V3',
          routerAddress: networkConfig.swapRouters.uniswap,
          fee: 0.3,
        },
        {
          name: 'SushiSwap',
          routerAddress: networkConfig.swapRouters.sushiswap,
          fee: 0.3,
        }
      ],
      tokens: Object.entries(networkConfig.tokens).map(([symbol, address]) => ({
        symbol,
        address,
        decimals: symbol === 'WETH' ? 18 : 
                 symbol === 'WBTC' ? 8 : 
                 ['USDC', 'USDT'].includes(symbol) ? 6 : 18
      })),
      minProfitUsd: config.get('validation.price.minProfitUsd') || 10,
      maxGasPrice: config.get('validation.gas.maxGasPrice') || 100,
      priorityFee: config.get('validation.gas.priorityFee') || 2,
      slippageTolerance: config.get('validation.liquidity.maxSlippagePercent') || 0.5,
      autoExecute: this.executionEnabled,
      enableMultiPathArbitrage: config.get('features.enableMultiPathArbitrage') || false,
      enableCexDexArbitrage: config.get('features.enableCexDexArbitrage') || false,
      flashLoanContractAddress: contractAddress,
      multiPathContractAddress: contractAddress,
    };
  }
  
  _setupEventHandlers() {
    // Handle opportunity events
    this.bot.on('opportunityFound', (opportunity) => {
      // Log to monitoring service
      MonitoringService.logArbitrageOpportunity(
        {
          token0: opportunity.tokenA,
          token1: opportunity.tokenB,
          token0Symbol: opportunity.tokenA,
          token1Symbol: opportunity.tokenB
        },
        ethers.parseEther(opportunity.rawProfit), // Convert to BigInt for monitoring service
        opportunity.buyDex,
        opportunity.sellDex
      );
    });
    
    // Handle execution attempts
    this.bot.on('executionAttempted', (execution) => {
      console.log(`Execution attempted: ${execution.tokenA}/${execution.tokenB}`);
    });
    
    // Handle execution results
    this.bot.on('executionCompleted', (result) => {
      if (result.success) {
        // Get tokens from result
        const { token0, token1, token0Symbol, token1Symbol } = result.tokens;
        
        // Log successful execution
        MonitoringService.logArbitrageExecution(
          result.txHash,
          { token0, token1, token0Symbol, token1Symbol },
          ethers.parseEther(result.profit), // Convert profit to BigInt
          ethers.parseEther(result.gasCost || '0'), // Convert gas cost to BigInt
          'success'
        );
        
        // Record execution in circuit breaker
        CircuitBreakerManager.recordExecution(
          ethers.parseEther(result.profit),
          ethers.parseEther(result.gasCost || '0'),
          { token0Symbol, token1Symbol }
        );
      } else {
        // Log failed execution
        MonitoringService.logError(new Error(`Execution failed: ${result.error}`), {
          txHash: result.txHash,
          tokens: result.tokens,
          error: result.error
        });
        
        // Record failure in circuit breaker
        if (result.tokens) {
          CircuitBreakerManager.recordExecution(
            ethers.parseEther('0'),
            ethers.parseEther(result.gasCost || '0'),
            result.tokens
          );
        }
      }
    });
    
    // Handle validation events
    this.bot.on('validationResult', (validation) => {
      if (!validation.isValid) {
        // Log validation failures for analysis
        MonitoringService.logError(new Error(`Validation failed: ${validation.details.reason}`), {
          validation: validation.details,
          critical: false
        });
      }
    });
    
    // Handle price validation events separately
    this.bot.on('priceValidationResult', (validation) => {
      if (!validation.isValid && validation.details.deviationPercent > 
          config.get('circuitBreakers.priceDeviationPercent')) {
        // Check if this price deviation should trigger circuit breaker
        CircuitBreakerManager.checkMarketConditions(
          {
            deviationPercent: validation.details.deviationPercent,
            token0: validation.details.token0,
            token1: validation.details.token1,
            price0: validation.details.price0,
            price1: validation.details.price1
          },
          null
        );
      }
    });
    
    // Handle liquidity validation events separately
    this.bot.on('liquidityValidationResult', (validation) => {
      if (!validation.isValid && validation.details.availablePercent < 
          config.get('circuitBreakers.liquidityThresholdPercent')) {
        // Check if this liquidity issue should trigger circuit breaker
        CircuitBreakerManager.checkMarketConditions(
          null,
          {
            availablePercent: validation.details.availablePercent,
            token0: validation.details.token0,
            token1: validation.details.token1,
            requiredAmount: validation.details.requiredAmount,
            availableAmount: validation.details.availableAmount
          }
        );
      }
    });
  }
  
  /**
   * Start the bot with full monitoring integration
   */
  async start() {
    if (this.isRunning) {
      console.log('Bot is already running');
      return;
    }
    
    // Check if circuit breaker is tripped
    if (CircuitBreakerManager.isTripped()) {
      const status = CircuitBreakerManager.getStatus();
      console.log(`Circuit breaker is active until ${status.cooldownUntil}`);
      
      // Log the circuit breaker status
      MonitoringService.info('Bot startup prevented by circuit breaker', status);
      
      return false;
    }
    
    console.log('Starting bot with monitoring integration...');
    
    // Set up periodic status reporting
    this.statusInterval = setInterval(() => {
      this._reportStatus();
    }, 15 * 60 * 1000); // Every 15 minutes
    
    // Start the bot
    this.isRunning = true;
    this.bot.startScanning();
    
    // Log start
    MonitoringService.info('Bot started', {
      timestamp: new Date().toISOString(),
      executionEnabled: this.executionEnabled
    });
    
    return true;
  }
  
  /**
   * Stop the bot
   */
  async stop() {
    if (!this.isRunning) {
      console.log('Bot is not running');
      return;
    }
    
    console.log('Stopping bot...');
    
    // Clear status interval
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = null;
    }
    
    // Stop the bot
    this.bot.stopScanning();
    this.isRunning = false;
    
    // Log stop
    MonitoringService.info('Bot stopped', {
      timestamp: new Date().toISOString(),
      stats: this.bot.getStats()
    });
  }
  
  /**
   * Report bot status to monitoring
   */
  _reportStatus() {
    if (!this.isRunning || !this.bot) return;
    
    const stats = this.bot.getStats();
    const circuitBreakerStatus = CircuitBreakerManager.getStatus();
    
    MonitoringService.info('Bot status update', {
      stats,
      circuitBreaker: circuitBreakerStatus,
      timestamp: new Date().toISOString()
    });
  }
  
  /**
   * Enable or disable execution
   */
  setExecutionEnabled(enabled) {
    this.executionEnabled = enabled;
    if (this.bot) {
      this.bot.setExecutionEnabled(enabled);
    }
    
    console.log(`Execution ${enabled ? 'enabled' : 'disabled'}`);
    MonitoringService.info(`Execution ${enabled ? 'enabled' : 'disabled'}`);
  }
  
  /**
   * Set maximum test amount
   */
  setMaxTestAmount(amountEth) {
    const amount = typeof amountEth === 'string' ? 
                  ethers.parseEther(amountEth) : 
                  amountEth;
                  
    this.maxTestAmount = amount;
    if (this.bot) {
      this.bot.setMaxTestAmount(amount);
    }
    
    console.log(`Max test amount set to ${ethers.formatEther(amount)} ETH`);
    MonitoringService.info(`Max test amount set to ${ethers.formatEther(amount)} ETH`);
  }
}

module.exports = BotMonitoringIntegration;