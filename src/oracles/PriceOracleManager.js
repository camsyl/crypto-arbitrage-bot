// Updated PriceOracleManager.js for ethers v6.7.1
const { ethers } = require('ethers');
const axios = require('axios');

class PriceOracleManager {
  constructor(provider, config) {
    this.provider = provider;
    this.config = config;
    this.chainlinkFeeds = {};
    this.cachedPrices = {};
    this.lastUpdateTime = {};
    this.priceUpdateInterval = 60 * 1000; // 1 minute default cache time
    
    // Initialize oracle contracts
    this.initializeChainlinkFeeds();
  }
  
  // Initialize Chainlink price feed contracts
  initializeChainlinkFeeds() {
    const chainlinkABI = [
      'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
      'function decimals() view returns (uint8)'
    ];
    
    // Add feeds from config
    if (this.config.oracles && this.config.oracles.chainlink) {
      const feeds = this.config.oracles.chainlink;
      
      // ETH/USD feed
      if (feeds.ethUsdFeed) {
        this.chainlinkFeeds['ETH/USD'] = {
          contract: new ethers.Contract(feeds.ethUsdFeed, chainlinkABI, this.provider),
          decimals: 8 // Default decimals for Chainlink (will be updated)
        };
      }
      
      // BTC/USD feed
      if (feeds.btcUsdFeed) {
        this.chainlinkFeeds['BTC/USD'] = {
          contract: new ethers.Contract(feeds.btcUsdFeed, chainlinkABI, this.provider),
          decimals: 8 // Default decimals for Chainlink (will be updated)
        };
      }
      
      // Add other feeds defined in config
      for (const [pair, address] of Object.entries(feeds)) {
        if (pair !== 'ethUsdFeed' && pair !== 'btcUsdFeed') {
          this.chainlinkFeeds[pair] = {
            contract: new ethers.Contract(address, chainlinkABI, this.provider),
            decimals: 8 // Default decimals for Chainlink (will be updated)
          };
        }
      }
    }
    
    // Initialize decimals for all feeds
    this.initializeDecimals();
  }
  
  // Get decimals for all Chainlink feeds
  async initializeDecimals() {
    for (const [pair, feed] of Object.entries(this.chainlinkFeeds)) {
      try {
        const decimals = await feed.contract.decimals();
        this.chainlinkFeeds[pair].decimals = decimals;
        console.log(`Initialized ${pair} feed with ${decimals} decimals`);
      } catch (error) {
        console.error(`Error getting decimals for ${pair}:`, error.message);
      }
    }
  }
  
  // Get price from Chainlink
  async getChainlinkPrice(pair) {
    try {
      const feed = this.chainlinkFeeds[pair];
      if (!feed) {
        throw new Error(`No Chainlink feed found for ${pair}`);
      }
      
      const { answer } = await feed.contract.latestRoundData();
      const price = parseFloat(ethers.formatUnits(answer, feed.decimals));
      
      return price;
    } catch (error) {
      console.error(`Error getting Chainlink price for ${pair}:`, error.message);
      return null;
    }
  }
  
  // Get price from CoinGecko API (as a fallback)
  async getCoinGeckoPrice(tokenId, vsCurrency = 'usd') {
    try {
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${tokenId}&vs_currencies=${vsCurrency}`
      );
      
      if (response.data && response.data[tokenId] && response.data[tokenId][vsCurrency]) {
        return response.data[tokenId][vsCurrency];
      } else {
        throw new Error(`No price data returned for ${tokenId}`);
      }
    } catch (error) {
      console.error(`Error getting CoinGecko price for ${tokenId}:`, error.message);
      return null;
    }
  }
  
  // Get token price with cache support
  async getTokenPrice(symbol, vsCurrency = 'usd') {
    const cacheKey = `${symbol}/${vsCurrency}`;
    
    // Check if we have a fresh cached price
    if (
      this.cachedPrices[cacheKey] &&
      this.lastUpdateTime[cacheKey] &&
      Date.now() - this.lastUpdateTime[cacheKey] < this.priceUpdateInterval
    ) {
      return this.cachedPrices[cacheKey];
    }
    
    // Try to get price from primary source (Chainlink)
    let price = null;
    const chainlinkPair = `${symbol}/USD`;
    
    if (this.chainlinkFeeds[chainlinkPair]) {
      price = await this.getChainlinkPrice(chainlinkPair);
    }
    
    // Fallback to CoinGecko if Chainlink fails or isn't available
    if (price === null) {
      const tokenIdMap = {
        'ETH': 'ethereum',
        'BTC': 'bitcoin',
        'LINK': 'chainlink',
        'AAVE': 'aave',
        'UNI': 'uniswap',
        'COMP': 'compound-governance-token',
        'SNX': 'synthetix-network-token',
        'YFI': 'yearn-finance',
        'SUSHI': 'sushi',
        'WBTC': 'wrapped-bitcoin',
        'DAI': 'dai',
        'USDC': 'usd-coin',
        'USDT': 'tether'
        // Add more mappings as needed
      };
      
      const tokenId = tokenIdMap[symbol];
      if (tokenId) {
        price = await this.getCoinGeckoPrice(tokenId, vsCurrency);
      }
    }
    
    // Cache the price if valid
    if (price !== null) {
      this.cachedPrices[cacheKey] = price;
      this.lastUpdateTime[cacheKey] = Date.now();
    }
    
    return price;
  }
  
  // Get price for a token pair (e.g., ETH/BTC)
  async getTokenPairPrice(baseSymbol, quoteSymbol) {
    try {
      const basePrice = await this.getTokenPrice(baseSymbol, 'usd');
      
      if (quoteSymbol.toUpperCase() === 'USD') {
        return basePrice;
      }
      
      const quotePrice = await this.getTokenPrice(quoteSymbol, 'usd');
      
      if (basePrice !== null && quotePrice !== null && quotePrice > 0) {
        return basePrice / quotePrice;
      } else {
        throw new Error(`Could not calculate price for ${baseSymbol}/${quoteSymbol}`);
      }
    } catch (error) {
      console.error(`Error getting pair price for ${baseSymbol}/${quoteSymbol}:`, error.message);
      return null;
    }
  }
  
  // Convert token amount to USD value
  async getUsdValue(tokenSymbol, amount, decimals) {
    const price = await this.getTokenPrice(tokenSymbol);
    if (price === null) return null;
    
    const amountFloat = parseFloat(ethers.formatUnits(amount, decimals));
    return amountFloat * price;
  }
  
  // Get gas price in USD
  async getGasPriceUsd(gasUnits) {
    try {
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice;
      const gasPriceGwei = parseFloat(ethers.formatUnits(gasPrice, 'gwei'));
      const ethPrice = await this.getTokenPrice('ETH');
      
      if (ethPrice === null) {
        throw new Error('Could not get ETH price');
      }
      
      // Calculate gas cost in ETH
      const gasUnitsNum = typeof gasUnits === 'number' ? gasUnits : 200000; // Default gas units
      const gasCostEth = gasUnitsNum * gasPriceGwei * 1e-9;
      
      // Convert to USD
      const gasCostUsd = gasCostEth * ethPrice;
      
      return {
        gasPrice: gasPriceGwei,
        gasCostEth,
        gasCostUsd
      };
    } catch (error) {
      console.error('Error calculating gas price in USD:', error.message);
      return null;
    }
  }
  
  // Calculate token conversion with slippage
  async calculateOutputWithSlippage(inputToken, outputToken, inputAmount, slippagePct, exchangeFee) {
    try {
      // Get token prices
      const inputTokenPrice = await this.getTokenPrice(inputToken);
      const outputTokenPrice = await this.getTokenPrice(outputToken);
      
      if (inputTokenPrice === null || outputTokenPrice === null) {
        throw new Error('Could not get token prices');
      }
      
      // Calculate the ideal output amount without slippage or fees
      const idealOutputAmount = (inputAmount * inputTokenPrice) / outputTokenPrice;
      
      // Apply exchange fee if provided
      const feeRate = exchangeFee || 0;
      const amountAfterFee = idealOutputAmount * (1 - feeRate);
      
      // Apply slippage tolerance
      const slippageRate = slippagePct / 100;
      const minimumOutputAmount = amountAfterFee * (1 - slippageRate);
      
      return {
        idealOutputAmount,
        amountAfterFee,
        minimumOutputAmount,
        inputValueUsd: inputAmount * inputTokenPrice,
        outputValueUsd: minimumOutputAmount * outputTokenPrice
      };
    } catch (error) {
      console.error('Error calculating output with slippage:', error.message);
      return null;
    }
  }
  
  // Query multiple oracles and return the median price
  async getMedianPrice(tokenSymbol, vsCurrency = 'usd') {
    try {
      const prices = [];
      
      // 1. Try Chainlink
      const chainlinkPrice = await this.getChainlinkPrice(`${tokenSymbol}/USD`);
      if (chainlinkPrice !== null) {
        prices.push(chainlinkPrice);
      }
      
      // 2. Try CoinGecko
      const tokenIdMap = {
        'ETH': 'ethereum',
        'BTC': 'bitcoin',
        // Add more mappings as needed
      };
      
      const tokenId = tokenIdMap[tokenSymbol];
      if (tokenId) {
        const coingeckoPrice = await this.getCoinGeckoPrice(tokenId, vsCurrency);
        if (coingeckoPrice !== null) {
          prices.push(coingeckoPrice);
        }
      }
      
      // 3. Try Binance API
      try {
        const binanceSymbol = `${tokenSymbol}${vsCurrency.toUpperCase()}`;
        const response = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbol}`);
        if (response.data && response.data.price) {
          prices.push(parseFloat(response.data.price));
        }
      } catch (error) {
        // Silently fail for Binance - it's just one of multiple sources
      }
      
      // If we have multiple prices, return the median
      if (prices.length > 0) {
        // Sort prices
        prices.sort((a, b) => a - b);
        
        // Get median
        const mid = Math.floor(prices.length / 2);
        const median = prices.length % 2 === 0
          ? (prices[mid - 1] + prices[mid]) / 2
          : prices[mid];
        
        return median;
      } else {
        throw new Error(`No price sources available for ${tokenSymbol}`);
      }
    } catch (error) {
      console.error(`Error getting median price for ${tokenSymbol}:`, error.message);
      return null;
    }
  }
  
  // Detect and alert on price outliers or manipulations
  async detectPriceAnomalies(tokenSymbol, threshold = 5) {
    try {
      const prices = [];
      
      // Get prices from different sources
      const chainlinkPrice = await this.getChainlinkPrice(`${tokenSymbol}/USD`);
      if (chainlinkPrice !== null) prices.push({ source: 'Chainlink', price: chainlinkPrice });
      
      const tokenIdMap = { 'ETH': 'ethereum', 'BTC': 'bitcoin' /* ... */ };
      const tokenId = tokenIdMap[tokenSymbol];
      
      if (tokenId) {
        const coingeckoPrice = await this.getCoinGeckoPrice(tokenId);
        if (coingeckoPrice !== null) prices.push({ source: 'CoinGecko', price: coingeckoPrice });
      }
      
      // Need at least 2 sources to compare
      if (prices.length < 2) return { anomalyDetected: false, reason: 'Not enough price sources' };
      
      // Calculate average price
      const avgPrice = prices.reduce((sum, p) => sum + p.price, 0) / prices.length;
      
      // Check for outliers
      const outliers = prices.filter(p => {
        const percentDiff = Math.abs((p.price - avgPrice) / avgPrice) * 100;
        return percentDiff > threshold;
      });
      
      if (outliers.length > 0) {
        return {
          anomalyDetected: true,
          avgPrice,
          outliers,
          details: `Price outliers detected for ${tokenSymbol}. Average price: ${avgPrice}, Outliers: ${JSON.stringify(outliers)}`
        };
      }
      
      return { anomalyDetected: false, avgPrice, prices };
    } catch (error) {
      console.error(`Error detecting price anomalies for ${tokenSymbol}:`, error.message);
      return { anomalyDetected: false, error: error.message };
    }
  }
}
// Add this at the very end of PriceOracleManager.js:
module.exports = PriceOracleManager;