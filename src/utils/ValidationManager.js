// src/utils/ValidationManager.js
const { ethers } = require('ethers');
const LiquidityValidator = require('./LiquidityValidator');
const PriceValidator = require('./PriceValidator');

/**
 * ValidationManager integrates all validation components and provides a unified
 * interface for validating arbitrage opportunities
 */
class ValidationManager {
  constructor(provider, config) {
    this.provider = provider;
    this.config = config;
    this.liquidityValidator = new LiquidityValidator(provider, config);
    this.priceValidator = new PriceValidator(provider, config);
    
    // Market conditions
    this.marketVolatility = 'normal'; // 'low', 'normal', 'high'
    this.riskTolerance = 'medium';    // 'low', 'medium', 'high'
    
    // Gas price optimization
    this.maxGasPrice = config.maxGasPrice || 100; // Gwei
    this.minProfitMultiplier = 2.0; // Profit must be this multiple of gas cost
  }

  /**
   * Set current market conditions to adjust validation thresholds
   * @param {string} volatility - Market volatility level ('low', 'normal', 'high')
   * @param {string} riskTolerance - Risk tolerance level ('low', 'medium', 'high')
   */
  setMarketConditions(volatility, riskTolerance) {
    this.marketVolatility = volatility;
    this.riskTolerance = riskTolerance;
    
    // Adjust validation parameters based on market conditions
    if (volatility === 'high') {
      // During high volatility, be more conservative
      this.minProfitMultiplier = 3.0;
    } else if (volatility === 'low') {
      // During low volatility, can be less conservative
      this.minProfitMultiplier = 1.5;
    } else {
      // Normal volatility
      this.minProfitMultiplier = 2.0;
    }
  }

  /**
   * Validates a potential arbitrage opportunity against all criteria
   * @param {Object} opportunity - The arbitrage opportunity
   * @returns {Promise<{isValid: boolean, details: Object}>}
   */
  async validateOpportunity(opportunity) {
    try {
      // 1. Check current gas prices first
      const gasPriceCheck = await this.checkGasPrice();
      if (!gasPriceCheck.isValid) {
        return gasPriceCheck;
      }
      
      // 2. Validate liquidity is sufficient
      const liquidityCheck = await this.liquidityValidator.validateOpportunity(opportunity);
      if (!liquidityCheck.isValid) {
        return liquidityCheck;
      }
      
      // 3. Validate price differences are realistic
      const priceCheck = await this.priceValidator.validateOpportunity(opportunity);
      if (!priceCheck.isValid) {
        return priceCheck;
      }
      
      // 4. Perform profitability analysis with current gas prices
      const profitabilityCheck = await this.analyzeProfitability(opportunity, gasPriceCheck.details.gasPrice);
      if (!profitabilityCheck.isValid) {
        return profitabilityCheck;
      }
      
      // 5. Perform pre-execution simulation if needed
      if (this.config.simulateBeforeExecution) {
        const simulationCheck = await this.simulateArbitrage(opportunity);
        if (!simulationCheck.isValid) {
          return simulationCheck;
        }
      }
      
      // Opportunity passed all checks
      return {
        isValid: true,
        details: {
          profitUsd: profitabilityCheck.details.netProfitUsd,
          gasCostUsd: profitabilityCheck.details.gasCostUsd,
          flashLoanFeeUsd: profitabilityCheck.details.flashLoanFeeUsd,
          netProfitUsd: profitabilityCheck.details.netProfitUsd,
          profitToGasRatio: profitabilityCheck.details.profitToGasRatio,
          warnings: [
            ...(priceCheck.details.warning ? [priceCheck.details.warning] : []),
            ...(liquidityCheck.details.warning ? [liquidityCheck.details.warning] : [])
          ]
        }
      };
    } catch (error) {
      return {
        isValid: false,
        details: {
          reason: `Validation error: ${error.message}`,
          error: error
        }
      };
    }
  }

  /**
   * Checks if current gas prices are acceptable
   * @returns {Promise<{isValid: boolean, details: Object}>}
   */
  async checkGasPrice() {
    try {
      // Get current gas price
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice;
      const gasPriceGwei = parseFloat(ethers.formatUnits(gasPrice, 'gwei'));
      
      // Check against maximum gas price
      if (gasPriceGwei > this.maxGasPrice) {
        return {
          isValid: false,
          details: {
            reason: `Gas price too high: ${gasPriceGwei.toFixed(2)} gwei > ${this.maxGasPrice} gwei`,
            gasPrice: gasPrice,
            gasPriceGwei: gasPriceGwei,
            maxGasPrice: this.maxGasPrice,
            check: 'gas_price'
          }
        };
      }
      
      return {
        isValid: true,
        details: {
          gasPrice: gasPrice,
          gasPriceGwei: gasPriceGwei
        }
      };
    } catch (error) {
      return {
        isValid: false,
        details: {
          reason: `Error checking gas price: ${error.message}`,
          check: 'gas_price'
        }
      };
    }
  }
  
  /**
   * Analyzes the profitability of an arbitrage opportunity considering all costs
   * @param {Object} opportunity - The arbitrage opportunity
   * @param {BigNumber} gasPrice - Current gas price
   * @returns {Promise<{isValid: boolean, details: Object}>}
   */
  async analyzeProfitability(opportunity, gasPrice) {
    try {
      const { tokenA, amountIn, profitUsd } = opportunity;
      
      // Get token info
      const tokenInfo = this.config.tokens.find(t => t.symbol === tokenA);
      if (!tokenInfo) {
        return {
          isValid: false,
          details: {
            reason: `Token info not found for ${tokenA}`,
            check: 'profitability'
          }
        };
      }
      
      // Convert input amount to ethers-compatible format
      const amount = ethers.parseUnits(amountIn.toString(), tokenInfo.decimals);
      
      // Calculate flash loan fee
      const flashLoanFeePercent = this.config.flashLoanProviders.aave.fee || 0.09;
      const flashLoanFee = amount * BigInt(Math.floor(flashLoanFeePercent * 100)) / 10000n;
      
      // Get token price in USD
      const tokenPriceUsd = await this.getTokenPriceUsd(tokenA);
      if (!tokenPriceUsd) {
        return {
          isValid: false,
          details: {
            reason: `Could not get price for ${tokenA}`,
            check: 'profitability'
          }
        };
      }
      
      // Convert flash loan fee to USD
      const flashLoanFeeUsd = Number(ethers.formatUnits(flashLoanFee, tokenInfo.decimals)) * tokenPriceUsd;
      
      // Estimate gas cost
      const estimatedGasLimit = 500000; // Conservative estimate for arbitrage transaction
      const gasCostWei = gasPrice * BigInt(estimatedGasLimit);
      const gasCostEth = Number(ethers.formatEther(gasCostWei));
      
      // Get ETH price in USD
      const ethPriceUsd = await this.getEthPriceUsd();
      if (!ethPriceUsd) {
        return {
          isValid: false,
          details: {
            reason: 'Could not get ETH price',
            check: 'profitability'
          }
        };
      }
      
      // Calculate gas cost in USD
      const gasCostUsd = gasCostEth * ethPriceUsd;
      
      // Calculate net profit
      const netProfitUsd = profitUsd - flashLoanFeeUsd - gasCostUsd;
      
      // Calculate profit to gas ratio
      const profitToGasRatio = gasCostUsd > 0 ? netProfitUsd / gasCostUsd : 0;
      
      // Check if profitable with minimum threshold
      const minProfitUsd = this.config.minProfitUsd || 10;
      
      // Apply profit multiplier based on market conditions
      const requiredProfitMultiplier = profitToGasRatio >= this.minProfitMultiplier;
      
      if (netProfitUsd <= minProfitUsd) {
        return {
          isValid: false,
          details: {
            reason: `Net profit (${netProfitUsd.toFixed(2)} USD) below minimum threshold (${minProfitUsd} USD)`,
            profitUsd,
            flashLoanFeeUsd,
            gasCostUsd,
            netProfitUsd,
            profitToGasRatio,
            check: 'profitability'
          }
        };
      }
      
      if (!requiredProfitMultiplier) {
        return {
          isValid: false,
          details: {
            reason: `Profit/gas ratio (${profitToGasRatio.toFixed(2)}) below required multiplier (${this.minProfitMultiplier})`,
            profitUsd,
            flashLoanFeeUsd,
            gasCostUsd,
            netProfitUsd,
            profitToGasRatio,
            requiredMultiplier: this.minProfitMultiplier,
            check: 'profitability'
          }
        };
      }
      
      // Passed all profitability checks
      return {
        isValid: true,
        details: {
          profitUsd,
          flashLoanFeeUsd,
          gasCostUsd,
          netProfitUsd,
          profitToGasRatio,
          ethPriceUsd,
          tokenPriceUsd
        }
      };
    } catch (error) {
      return {
        isValid: false,
        details: {
          reason: `Error calculating profitability: ${error.message}`,
          check: 'profitability'
        }
      };
    }
  }
  
  /**
   * Get token price in USD
   * @param {string} symbol - Token symbol
   * @returns {Promise<number|null>} - Token price in USD
   */
  async getTokenPriceUsd(symbol) {
    // This is a placeholder - in production, use a price oracle or API
    const prices = {
      'WETH': 2500,
      'WBTC': 40000,
      'USDC': 1,
      'USDT': 1,
      'DAI': 1
    };
    
    return prices[symbol] || null;
  }
  
  /**
   * Get ETH price in USD
   * @returns {Promise<number|null>} - ETH price in USD
   */
  async getEthPriceUsd() {
    try {
      // This would normally use Chainlink or another oracle
      return 2500; // Example price
    } catch (error) {
      console.error('Error getting ETH price:', error);
      return null;
    }
  }
  
  /**
   * Simulate arbitrage execution before attempting the actual transaction
   * @param {Object} opportunity - The arbitrage opportunity
   * @returns {Promise<{isValid: boolean, details: Object}>}
   */
  async simulateArbitrage(opportunity) {
    try {
      // This would normally use eth_call or tenderly/similar simulation platform
      // to simulate the transaction without actually executing it
      
      // For now, we'll just assume the simulation is successful
      return {
        isValid: true,
        details: {
          simulationResult: 'success'
        }
      };
    } catch (error) {
      return {
        isValid: false,
        details: {
          reason: `Simulation failed: ${error.message}`,
          check: 'simulation'
        }
      };
    }
  }

  /**
   * Calculate maximum allowed amount based on DEX liquidity
   * @param {string} tokenA - First token symbol
   * @param {string} tokenB - Second token symbol
   * @param {string} dex - DEX name
   * @returns {Promise<BigNumber>} - Maximum safe amount
   */
  async calculateMaxTradeSize(tokenA, tokenB, dex) {
    try {
      const tokenAInfo = this.config.tokens.find(t => t.symbol === tokenA);
      const tokenBInfo = this.config.tokens.find(t => t.symbol === tokenB);
      
      if (!tokenAInfo || !tokenBInfo) {
        throw new Error(`Token info not found for ${tokenA} or ${tokenB}`);
      }
      
      // Get DEX reserves
      const reserves = await this.liquidityValidator.getDexReserves(
        dex,
        tokenAInfo,
        tokenBInfo
      );
      
      if (!reserves.success) {
        throw new Error(reserves.error);
      }
      
      // Calculate safe percentage (e.g., 2% of reserve)
      const safePercentage = 2n;
      const maxAmount = reserves.reserveIn * safePercentage / 100n;
      
      return maxAmount;
    } catch (error) {
      console.error(`Error calculating max trade size: ${error.message}`);
      return 0n;
    }
  }
}
module.exports = ValidationManager;