// src/utils/EnhancedValidationManager.js
const ValidationManager = require('./ValidationManager');
const LiquidityValidator = require('./LiquidityValidator');
const PriceValidator = require('./PriceValidator');
const CircuitBreakerManager = require('../risk/CircuitBreakerManager');
const MonitoringService = require('../monitoring/MonitoringService');
const { ethers } = require('ethers');
const config = require('config');

/**
 * Enhanced Validation Manager that coordinates all validation systems
 * and integrates with circuit breakers and monitoring
 */
class EnhancedValidationManager {
  constructor(provider) {
    this.provider = provider;
    
    // Initialize base validators
    this.validationManager = new ValidationManager(provider);
    this.liquidityValidator = new LiquidityValidator(provider);
    this.priceValidator = new PriceValidator(provider);
    
    // Load configuration
    this.loadConfig();
    
    // Validation flags
    this.validationEnabled = true;
    this.strictMode = false;
    
    // Event listeners
    this.listeners = {
      validationResult: [],
      priceValidationResult: [],
      liquidityValidationResult: []
    };
  }
  
  /**
   * Load validation configuration
   */
  loadConfig() {
    try {
      // Liquidity validation config
      if (config.has('validation.liquidity')) {
        const liquidityConfig = config.get('validation.liquidity');
        this.liquidityValidator.setConfig({
          minLiquidityUSD: liquidityConfig.minLiquidityUSD || 10000,
          maxSlippagePercent: liquidityConfig.maxSlippagePercent || 2.5,
          reservesCheckEnabled: liquidityConfig.reservesCheckEnabled !== false
        });
      }
      
      // Price validation config
      if (config.has('validation.price')) {
        const priceConfig = config.get('validation.price');
        this.priceValidator.setConfig({
          maxDeviationPercent: priceConfig.maxDeviationPercent || 10,
          oracleComparisonEnabled: priceConfig.oracleComparisonEnabled !== false,
          minSpreadPercent: priceConfig.minSpreadPercent || 0.5,
          minProfitUsd: priceConfig.minProfitUsd || 10
        });
      }
      
      console.log('Validation configuration loaded');
    } catch (error) {
      console.error('Error loading validation configuration:', error.message);
    }
  }
  
  /**
   * Set validation configuration overrides
   */
  setOverrides(overrides) {
    if (overrides.liquidity) {
      this.liquidityValidator.setConfig(overrides.liquidity);
    }
    
    if (overrides.price) {
      this.priceValidator.setConfig(overrides.price);
    }
    
    console.log('Validation overrides applied');
  }
  
  /**
   * Enable or disable validation
   */
  setValidationEnabled(enabled) {
    this.validationEnabled = enabled;
    console.log(`Validation ${enabled ? 'enabled' : 'disabled'}`);
  }
  
  /**
   * Set strict validation mode
   */
  setStrictMode(strict) {
    this.strictMode = strict;
    
    // In strict mode, we lower thresholds for safety
    if (strict) {
      this.liquidityValidator.setConfig({
        minLiquidityUSD: this.liquidityValidator.config.minLiquidityUSD * 1.5,
        maxSlippagePercent: this.liquidityValidator.config.maxSlippagePercent * 0.7
      });
      
      this.priceValidator.setConfig({
        maxDeviationPercent: this.priceValidator.config.maxDeviationPercent * 0.7,
        minSpreadPercent: this.priceValidator.config.minSpreadPercent * 1.5
      });
      
      console.log('Strict validation mode enabled with tighter thresholds');
    } else {
      // Reset to default config
      this.loadConfig();
      console.log('Normal validation mode restored');
    }
  }
  
  /**
   * Set market conditions to adjust validation parameters dynamically
   */
  setMarketConditions(volatility, risk) {
    // Adjust validation parameters based on market conditions
    let liquidityMultiplier = 1.0;
    let priceDeviationMultiplier = 1.0;
    let minProfitMultiplier = 1.0;
    
    // Adjust for volatility
    if (volatility === 'high') {
      liquidityMultiplier = 1.5;      // Require more liquidity
      priceDeviationMultiplier = 0.7; // Be more strict about price deviations
      minProfitMultiplier = 1.3;      // Require higher profit
    } else if (volatility === 'low') {
      liquidityMultiplier = 0.8;      // Can accept lower liquidity
      priceDeviationMultiplier = 1.2; // Can be more lenient on price deviations
      minProfitMultiplier = 0.9;      // Can accept slightly lower profit
    }
    
    // Adjust for risk level
    if (risk === 'high') {
      liquidityMultiplier *= 0.8;     // Accept lower liquidity
      priceDeviationMultiplier *= 1.3; // Accept higher price deviations
      minProfitMultiplier *= 0.8;     // Accept lower profit
    } else if (risk === 'low') {
      liquidityMultiplier *= 1.3;     // Require more liquidity
      priceDeviationMultiplier *= 0.8; // Be more strict about price deviations
      minProfitMultiplier *= 1.2;     // Require higher profit
    }
    
    // Apply the adjustments
    this.liquidityValidator.setConfig({
      minLiquidityUSD: this.liquidityValidator.config.minLiquidityUSD * liquidityMultiplier,
    });
    
    this.priceValidator.setConfig({
      maxDeviationPercent: this.priceValidator.config.maxDeviationPercent * priceDeviationMultiplier,
      minProfitUsd: this.priceValidator.config.minProfitUsd * minProfitMultiplier
    });
    
    console.log(`Market conditions set to: volatility=${volatility}, risk=${risk}`);
    console.log(`Applied multipliers: liquidity=${liquidityMultiplier.toFixed(2)}, priceDeviation=${priceDeviationMultiplier.toFixed(2)}, minProfit=${minProfitMultiplier.toFixed(2)}`);
  }
  
  /**
   * Register event listeners
   */
  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
      return true;
    }
    return false;
  }
  
  /**
   * Emit events to registered listeners
   */
  emit(event, data) {
    if (this.listeners[event]) {
      for (const callback of this.listeners[event]) {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in ${event} event listener:`, error);
        }
      }
    }
  }
  
  /**
   * Main method to validate an arbitrage opportunity
   */
  async validateOpportunity(opportunity) {
    // Skip validation if disabled
    if (!this.validationEnabled) {
      return { isValid: true, details: { reason: 'Validation disabled' } };
    }
    
    // Check if the circuit breaker is tripped
    if (CircuitBreakerManager.isTripped()) {
      const invalidResult = { 
        isValid: false, 
        details: { 
          reason: 'Circuit breaker active',
          circuitBreakerStatus: CircuitBreakerManager.getStatus()
        } 
      };
      
      this.emit('validationResult', invalidResult);
      return invalidResult;
    }
    
    try {
      // 1. Parse token addresses and amounts
      const tokenA = opportunity.tokenAAddress;
      const tokenB = opportunity.tokenBAddress;
      const amountIn = ethers.parseUnits(opportunity.amountIn, this._getDecimals(opportunity.tokenA));
      
      // 2. Validate liquidity
      const liquidityValidation = await this.liquidityValidator.validateLiquidity(
        tokenA,
        tokenB,
        amountIn,
        opportunity.buyDex
      );
      
      // Emit liquidity validation result
      this.emit('liquidityValidationResult', liquidityValidation);
      
      if (!liquidityValidation.isValid) {
        return liquidityValidation;
      }
      
      // 3. Validate price deviations
      const priceValidation = await this.priceValidator.validatePrices(
        opportunity.tokenA,
        opportunity.tokenB,
        opportunity.buyDex,
        opportunity.sellDex,
        parseFloat(opportunity.profitUsd)
      );
      
      // Emit price validation result
      this.emit('priceValidationResult', priceValidation);
      
      if (!priceValidation.isValid) {
        return priceValidation;
      }
      
      // 4. Perform gas cost analysis
      const gasCostValidation = await this._validateGasCosts(opportunity);
      if (!gasCostValidation.isValid) {
        this.emit('validationResult', gasCostValidation);
        return gasCostValidation;
      }
      
      // 5. All validations passed
      const validResult = {
        isValid: true,
        details: {
          ...opportunity,
          validatedBy: {
            liquidity: liquidityValidation.details,
            price: priceValidation.details,
            gas: gasCostValidation.details
          },
          netProfitUsd: gasCostValidation.details.netProfitUsd
        }
      };
      
      this.emit('validationResult', validResult);
      return validResult;
      
    } catch (error) {
      console.error('Error in validation:', error);
      
      const errorResult = {
        isValid: false,
        details: {
          reason: `Validation error: ${error.message}`,
          error: error.message
        }
      };
      
      this.emit('validationResult', errorResult);
      return errorResult;
    }
  }
  
  /**
   * Validate gas costs and overall profitability
   */
  async _validateGasCosts(opportunity) {
    try {
      // Get current gas price
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice;
      const gasPriceGwei = parseFloat(ethers.formatUnits(gasPrice, 'gwei'));
      
      // Skip if gas price is too high
      const maxGasPrice = config.get('validation.gas.maxGasPrice') || 100;
      if (gasPriceGwei > maxGasPrice) {
        return {
          isValid: false,
          details: {
            reason: `Gas price too high: ${gasPriceGwei} gwei > ${maxGasPrice} gwei`,
            gasPrice: gasPriceGwei,
            maxGasPrice
          }
        };
      }
      
      // Estimate gas cost - we're using a fixed estimate here
      // In production, you'd want to make a more accurate estimation
      const estimatedGasLimit = 1000000; // 1 million gas units
      const gasCostWei = gasPrice * BigInt(estimatedGasLimit);
      const gasCostEth = parseFloat(ethers.formatEther(gasCostWei));
      
      // Get ETH price in USD
      const ethPriceUsd = await this._getEthPriceUsd();
      const gasCostUsd = gasCostEth * ethPriceUsd;
      
      // Calculate flash loan fee
      const flashLoanFeePercent = 0.09; // Aave's 0.09%
      const amountInEth = parseFloat(opportunity.amountIn) * 
                         (opportunity.tokenA === 'WETH' ? 1 : 
                          opportunity.tokenA === 'WBTC' ? ethPriceUsd / 20000 : // Rough BTC/ETH ratio
                          1 / ethPriceUsd); // Convert to ETH equivalent for other tokens
                          
      const flashLoanFeeEth = amountInEth * (flashLoanFeePercent / 100);
      const flashLoanFeeUsd = flashLoanFeeEth * ethPriceUsd;
      
      // Calculate total costs
      const totalCostsUsd = gasCostUsd + flashLoanFeeUsd;
      
      // Calculate net profit
      const netProfitUsd = opportunity.profitUsd - totalCostsUsd;
      
      // Get minimum required profit
      const minProfitUsd = this.priceValidator.config.minProfitUsd;
      
      // Check if profitable
      if (netProfitUsd <= minProfitUsd) {
        return {
          isValid: false,
          details: {
            reason: `Not profitable after costs: $${netProfitUsd.toFixed(2)} <= $${minProfitUsd.toFixed(2)}`,
            profitUsd: opportunity.profitUsd,
            gasCostUsd,
            flashLoanFeeUsd,
            totalCostsUsd,
            netProfitUsd,
            minProfitUsd
          }
        };
      }
      
      // Profitable
      return {
        isValid: true,
        details: {
          gasPrice: gasPriceGwei,
          gasCostEth,
          gasCostUsd,
          flashLoanFeeEth,
          flashLoanFeeUsd,
          totalCostsUsd,
          netProfitUsd,
          profitMarginPercent: (netProfitUsd / opportunity.profitUsd) * 100
        }
      };
    } catch (error) {
      console.error('Error in gas cost validation:', error);
      return {
        isValid: false,
        details: {
          reason: `Gas validation error: ${error.message}`,
          error: error.message
        }
      };
    }
  }
  
  /**
   * Get ETH price in USD
   */
  async _getEthPriceUsd() {
    return await this.priceValidator.getTokenPriceUsd('WETH');
  }
  
  /**
   * Get token decimals
   */
  _getDecimals(symbol) {
    if (symbol === 'WETH') return 18;
    if (symbol === 'WBTC') return 8;
    if (['USDC', 'USDT'].includes(symbol)) return 6;
    return 18; // Default for most tokens
  }
}

module.exports = EnhancedValidationManager;