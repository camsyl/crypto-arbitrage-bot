// src/utils/PriceValidator.js
const { ethers } = require('ethers');
const axios = require('axios');

/**
 * PriceValidator helps validate and filter realistic price differences
 * for arbitrage opportunities, protecting against manipulation and sandwich attacks.
 */
class PriceValidator {
  constructor(provider, config) {
    this.provider = provider;
    this.config = config;
    this.priceCache = new Map(); // Cache of recent token prices
    this.priceUpdateInterval = 60000; // 1 minute cache
    this.lastMarketPriceUpdate = 0;
    this.marketPrices = {}; // Market prices from external APIs
  }

  /**
   * Gets the deviation threshold for a token pair
   * @param {string} tokenASymbol - Symbol of the first token
   * @param {string} tokenBSymbol - Symbol of the second token
   * @returns {number} - Maximum allowed price deviation in percentage
   */
  getDeviationThreshold(tokenASymbol, tokenBSymbol) {
    // Default threshold
    let threshold = 1.0; // 1% default
    
    // Stablecoins should have much tighter thresholds
    const stablecoins = ['USDC', 'USDT', 'DAI', 'BUSD', 'TUSD', 'FRAX'];
    
    if (stablecoins.includes(tokenASymbol) && stablecoins.includes(tokenBSymbol)) {
      return 0.2; // 0.2% for stablecoin pairs
    }
    
    // Liquid mainstream assets can have moderate thresholds
    const mainstream = ['WETH', 'WBTC', 'WBNB', 'MATIC'];
    
    if (mainstream.includes(tokenASymbol) && mainstream.includes(tokenBSymbol)) {
      return 0.5; // 0.5% for mainstream pairs
    }
    
    // If one token is a stablecoin and one is mainstream
    if (
      (stablecoins.includes(tokenASymbol) && mainstream.includes(tokenBSymbol)) ||
      (stablecoins.includes(tokenBSymbol) && mainstream.includes(tokenASymbol))
    ) {
      return 0.75; // 0.75% for stablecoin-mainstream pairs
    }
    
    // DeFi tokens can have higher thresholds
    const defi = ['AAVE', 'UNI', 'SUSHI', 'COMP', 'MKR', 'CRV', 'YFI'];
    
    if (
      (defi.includes(tokenASymbol) || defi.includes(tokenBSymbol)) &&
      (mainstream.includes(tokenASymbol) || mainstream.includes(tokenBSymbol))
    ) {
      return 1.25; // 1.25% for DeFi-mainstream pairs
    }
    
    return threshold;
  }

  /**
   * Validates if a price difference is realistic based on the token pair and market conditions
   * @param {Object} opportunity - The arbitrage opportunity to validate
   * @returns {Promise<{isValid: boolean, reason: string}>}
   */
  async validatePriceDifference(opportunity) {
    const { 
      tokenA, 
      tokenB, 
      buyDex, 
      sellDex, 
      spreadPercentage 
    } = opportunity;
    
    // 1. Get the appropriate threshold for this token pair
    const threshold = this.getDeviationThreshold(tokenA, tokenB);
    
    // 2. Check if the spread exceeds the threshold
    if (spreadPercentage > threshold) {
      // 3. For spreads exceeding the threshold, perform additional validations
      
      // 3.1 Compare with recent historical spreads (if available)
      const recentSpreadsCheck = await this.checkAgainstRecentSpreads(tokenA, tokenB, buyDex, sellDex, spreadPercentage);
      if (!recentSpreadsCheck.isValid) {
        return recentSpreadsCheck;
      }
      
      // 3.2 Compare with external market price references
      const marketPriceCheck = await this.compareWithMarketPrices(tokenA, tokenB, spreadPercentage);
      if (!marketPriceCheck.isValid) {
        return marketPriceCheck;
      }
      
      // 3.3 Check for common attack patterns
      const attackPatternCheck = this.checkForAttackPatterns(opportunity);
      if (!attackPatternCheck.isValid) {
        return attackPatternCheck;
      }
      
      // If the spread is high but passes all additional checks, we can allow it
      // but with a warning
      return {
        isValid: true,
        reason: `High spread (${spreadPercentage.toFixed(2)}%) but validated against market data`,
        warning: `Spread exceeds normal threshold (${threshold}%) - proceed with caution`
      };
    }
    
    // If spread is within threshold, it's considered valid
    return {
      isValid: true,
      reason: `Spread (${spreadPercentage.toFixed(2)}%) within acceptable threshold (${threshold}%)`
    };
  }

  /**
   * Checks if the current spread is significantly different from recent spreads
   * @param {string} tokenA - Symbol of the first token
   * @param {string} tokenB - Symbol of the second token
   * @param {string} buyDex - The DEX used to buy
   * @param {string} sellDex - The DEX used to sell
   * @param {number} currentSpread - The current spread percentage
   * @returns {Promise<{isValid: boolean, reason: string}>}
   */
  async checkAgainstRecentSpreads(tokenA, tokenB, buyDex, sellDex, currentSpread) {
    // This would normally check a database or in-memory storage of recent spreads
    // For this example, we'll simulate the check
    
    // Get the pair key for our recent spreads storage
    const pairKey = `${tokenA}-${tokenB}-${buyDex}-${sellDex}`;
    
    // Simulate recent spreads (would be replaced with actual historical data)
    const recentSpreads = this.getRecentSpreads(pairKey);
    
    if (recentSpreads.length > 0) {
      // Calculate average and standard deviation
      const sum = recentSpreads.reduce((a, b) => a + b, 0);
      const avg = sum / recentSpreads.length;
      
      // Calculate standard deviation
      const squareDiffs = recentSpreads.map(spread => {
        const diff = spread - avg;
        return diff * diff;
      });
      const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / squareDiffs.length;
      const stdDev = Math.sqrt(avgSquareDiff);
      
      // Define how many standard deviations we allow
      const maxStdDev = 3; // 3 standard deviations
      
      // Check if current spread is an outlier
      if (currentSpread > avg + (stdDev * maxStdDev)) {
        return {
          isValid: false,
          reason: `Spread (${currentSpread.toFixed(2)}%) is ${((currentSpread - avg) / stdDev).toFixed(1)} standard deviations above average (${avg.toFixed(2)}%)`
        };
      }
    }
    
    // No historical data or within acceptable range
    return {
      isValid: true,
      reason: 'Spread consistent with historical data'
    };
  }

  /**
   * Simulates getting recent spreads for a token pair
   * (In production, this would pull from a database)
   * @param {string} pairKey - The key identifying the token pair and DEXes
   * @returns {number[]} - Array of recent spread percentages
   */
  getRecentSpreads(pairKey) {
    // This is a simulation - in production, you'd retrieve from a database
    // Generate some random recent spreads around a mean value
    const defaultSpreads = [0.2, 0.3, 0.25, 0.22, 0.18, 0.26, 0.21, 0.28];
    
    // For stablecoin pairs, use lower spreads
    if (pairKey.includes('USDC') || pairKey.includes('USDT') || pairKey.includes('DAI')) {
      return [0.05, 0.06, 0.04, 0.07, 0.05, 0.08, 0.06, 0.05];
    }
    
    return defaultSpreads;
  }

  /**
   * Compares the arbitrage spread with market prices from external sources
   * @param {string} tokenA - Symbol of the first token
   * @param {string} tokenB - Symbol of the second token
   * @param {number} spreadPercentage - The current spread percentage
   * @returns {Promise<{isValid: boolean, reason: string}>}
   */
  async compareWithMarketPrices(tokenA, tokenB, spreadPercentage) {
    // Check if we need to refresh market prices
    if (Date.now() - this.lastMarketPriceUpdate > this.priceUpdateInterval) {
      await this.updateMarketPrices();
    }
    
    // If we have market prices for both tokens
    if (this.marketPrices[tokenA] && this.marketPrices[tokenB]) {
      // Calculate the market-based exchange rate
      const marketRate = this.marketPrices[tokenA] / this.marketPrices[tokenB];
      
      // Allow for some deviation from market price (e.g., 2%)
      const maxMarketDeviation = 2.0;
      
      // If the spread is more than the max deviation from market rate
      if (spreadPercentage > maxMarketDeviation) {
        return {
          isValid: false,
          reason: `Spread (${spreadPercentage.toFixed(2)}%) exceeds maximum market deviation (${maxMarketDeviation}%)`
        };
      }
    }
    
    return {
      isValid: true,
      reason: 'Spread consistent with market prices'
    };
  }

  /**
   * Updates market prices from external sources
   * @returns {Promise<void>}
   */
  async updateMarketPrices() {
    try {
      // This would normally call a price API like CoinGecko, CoinMarketCap, etc.
      // For this example, we'll simulate the API call
      
      // Simulated market prices (in USD)
      const simulatedPrices = {
        'WETH': 2500,
        'WBTC': 40000,
        'USDC': 1,
        'USDT': 1,
        'DAI': 1,
        'WBNB': 300,
        'MATIC': 0.8,
        'AAVE': 80,
        'UNI': 5,
        'SUSHI': 1.2,
        'COMP': 50,
        'MKR': 1200,
        'CRV': 0.5,
        'YFI': 8000
      };
      
      this.marketPrices = simulatedPrices;
      this.lastMarketPriceUpdate = Date.now();
      
    } catch (error) {
      console.error('Error updating market prices:', error.message);
    }
  }

  /**
   * Checks for common attack patterns that might indicate price manipulation
   * @param {Object} opportunity - The arbitrage opportunity
   * @returns {{isValid: boolean, reason: string}}
   */
  checkForAttackPatterns(opportunity) {
    const { 
      tokenA, 
      tokenB, 
      buyDex, 
      sellDex, 
      amountIn,
      spreadPercentage 
    } = opportunity;
    
    // 1. Check for newly deployed tokens (not implemented here, would need token age check)
    
    // 2. Check for suspicious volume patterns
    // This would require monitoring volume over time
    
    // 3. Check for suspiciously high spreads with large amounts
    const highSpreadThreshold = 5.0; // 5%
    const largeAmountThreshold = '10000'; // Example threshold, depends on token
    
    if (spreadPercentage > highSpreadThreshold && 
        parseFloat(amountIn) > parseFloat(largeAmountThreshold)) {
      return {
        isValid: false,
        reason: `Suspiciously high spread (${spreadPercentage.toFixed(2)}%) with large amount (${amountIn})`
      };
    }
    
    // 4. Check for common MEV sandwich attack patterns
    // This would analyze transaction pool/mempool data
    
    // 5. Check for suspicious token characteristics
    // Like unusual transfer fees, rebasing mechanisms, etc.
    
    return {
      isValid: true,
      reason: 'No suspicious attack patterns detected'
    };
  }

  /**
   * Validates the overall arbitrage opportunity
   * @param {Object} opportunity - The arbitrage opportunity
   * @returns {Promise<{isValid: boolean, details: Object}>}
   */
  async validateOpportunity(opportunity) {
    // 1. Validate price difference
    const priceCheck = await this.validatePriceDifference(opportunity);
    if (!priceCheck.isValid) {
      return {
        isValid: false,
        details: {
          reason: priceCheck.reason,
          check: 'price_difference'
        }
      };
    }
    
    // 2. Check for other opportunity-specific validations
    // This could include token-specific checks, etc.
    
    return {
      isValid: true,
      details: {
        threshold: this.getDeviationThreshold(opportunity.tokenA, opportunity.tokenB),
        spreadPercentage: opportunity.spreadPercentage,
        warning: priceCheck.warning || null
      }
    };
  }
}

module.exports = PriceValidator;