// Updated MultiPathArbitrageStrategy.js for ethers v6.7.1
const { ethers } = require('ethers');
const PriceOracleManager = require('../oracles/PriceOracleManager');

class MultiPathArbitrageStrategy {
  constructor(provider, config, priceOracle) {
    this.provider = provider;
    this.config = config;
    this.priceOracle = priceOracle || (
      typeof PriceOracleManager === 'function' ? 
        new PriceOracleManager(provider, config) : 
        {
          // Simplified PriceOracle implementation
          getTokenPrice: async (symbol) => {
            const prices = { 'WETH': 2500, 'USDC': 1, 'USDT': 1, 'DAI': 1, 'WBTC': 50000 };
            return prices[symbol] || 1;
          },
          getGasPriceUsd: async (gasUnits) => ({
            gasPrice: 50, // gwei
            gasCostEth: gasUnits * 50 * 1e-9,
            gasCostUsd: gasUnits * 50 * 1e-9 * 2500 // ETH price * gas cost in ETH
          })
        }
    );
    this.tokenGraph = this.buildTokenGraph();
  }

  // Build a graph representation of token trading pairs
  buildTokenGraph() {
    const graph = {};
    
    // Initialize graph with all tokens
    for (const token of this.config.tokens) {
      graph[token.address] = [];
    }
    
    // Add edges for each DEX and trading pair
    for (const dex of this.config.supportedDexes) {
      // For each token pair, add bidirectional edges
      for (let i = 0; i < this.config.tokens.length; i++) {
        for (let j = i + 1; j < this.config.tokens.length; j++) {
          const tokenA = this.config.tokens[i];
          const tokenB = this.config.tokens[j];
          
          // Add edge A -> B with the DEX info
          graph[tokenA.address].push({
            target: tokenB.address,
            dex: dex.name,
            fee: dex.fee
          });
          
          // Add edge B -> A with the DEX info
          graph[tokenB.address].push({
            target: tokenA.address,
            dex: dex.name,
            fee: dex.fee
          });
        }
      }
    }
    
    return graph;
  }
  
  // Find the most profitable arbitrage path for a given starting token and amount
  async findArbitragePath(startTokenAddress, amount, maxPathLength = 4) {
    console.log(`Finding arbitrage path starting with ${amount} of token ${startTokenAddress}`);
    
    // Track visited paths to avoid cycles
    const visited = new Set();
    
    // Priority queue to explore paths in order of profitability
    const queue = new PriorityQueue((a, b) => a.expectedOutput > b.expectedOutput);
    
    // Start with the initial token
    queue.enqueue({
      path: [startTokenAddress],
      dexPath: [],
      expectedOutput: amount,
      currentToken: startTokenAddress
    });
    
    let bestPath = null;
    let bestProfit = 0n;
    
    while (!queue.isEmpty()) {
      const { path, dexPath, expectedOutput, currentToken } = queue.dequeue();
      
      // If we've completed a cycle back to the start token, check for profit
      if (path.length > 1 && currentToken === startTokenAddress) {
        // Calculate profit (final amount - initial amount)
        const profit = expectedOutput - amount;
        
        if (profit > bestProfit) {
          bestProfit = profit;
          bestPath = {
            path,
            dexPath,
            expectedOutput,
            profit
          };
          
          console.log(`Found profitable path: ${path.map(this.getTokenSymbol.bind(this)).join(' -> ')}`);
          console.log(`Expected profit: ${ethers.formatUnits(profit, this.getTokenDecimals(startTokenAddress))}`);
        }
        
        // Don't continue this path further
        continue;
      }
      
      // Skip if path is too long
      if (path.length >= maxPathLength) {
        continue;
      }
      
      // Get neighboring tokens from the graph
      const neighbors = this.tokenGraph[currentToken] || [];
      
      for (const neighbor of neighbors) {
        // Skip if this would create a cycle before returning to start
        if (path.includes(neighbor.target) && neighbor.target !== startTokenAddress) {
          continue;
        }
        
        // Create path key to check if this sub-path has been visited
        const pathKey = `${currentToken}-${neighbor.target}-${neighbor.dex}`;
        if (visited.has(pathKey)) {
          continue;
        }
        
        visited.add(pathKey);
        
        // Get the expected output for this swap
        const outputAmount = await this.getExpectedOutput(
          currentToken,
          neighbor.target,
          expectedOutput,
          neighbor.dex,
          neighbor.fee
        );
        
        // If the output is valid and positive, add to queue
        if (outputAmount && outputAmount > 0n) {
          queue.enqueue({
            path: [...path, neighbor.target],
            dexPath: [...dexPath, { from: currentToken, to: neighbor.target, dex: neighbor.dex }],
            expectedOutput: outputAmount,
            currentToken: neighbor.target
          });
        }
      }
    }
    
    return bestPath;
  }
  
  // Get expected output amount for a swap between two tokens
  async getExpectedOutput(tokenIn, tokenOut, amountIn, dexName, fee) {
    try {
      // Get the DEX configuration
      const dex = this.config.supportedDexes.find(d => d.name === dexName);
      if (!dex) {
        throw new Error(`DEX ${dexName} not found in configuration`);
      }
      
      // Get token info
      const tokenInInfo = this.getTokenInfo(tokenIn);
      const tokenOutInfo = this.getTokenInfo(tokenOut);
      
      if (!tokenInInfo || !tokenOutInfo) {
        throw new Error(`Token info not found for ${tokenIn} or ${tokenOut}`);
      }
      
      // Calculate expected output using the price oracle with fees
      const inputAmountInUnits = ethers.formatUnits(amountIn, tokenInInfo.decimals);
      
      // Get token prices in USD
      const inputTokenPriceUsd = await this.priceOracle.getTokenPrice(tokenInInfo.symbol);
      const outputTokenPriceUsd = await this.priceOracle.getTokenPrice(tokenOutInfo.symbol);
      
      if (!inputTokenPriceUsd || !outputTokenPriceUsd) {
        throw new Error(`Could not get price for ${tokenInInfo.symbol} or ${tokenOutInfo.symbol}`);
      }
      
      // Calculate ideal output amount
      const inputValueUsd = parseFloat(inputAmountInUnits) * inputTokenPriceUsd;
      const outputValueUsd = inputValueUsd * (1 - (fee / 100)); // Apply DEX fee
      
      const outputAmountIdeal = outputValueUsd / outputTokenPriceUsd;
      
      // Apply slippage estimate based on amount size
      // This is a simple model - in production, you'd use more sophisticated slippage estimation
      const slippageEstimate = this.estimateSlippage(inputValueUsd, dexName);
      const outputAmountWithSlippage = outputAmountIdeal * (1 - slippageEstimate);
      
      // Convert back to BigInt with proper decimals
      const outputAmount = ethers.parseUnits(
        outputAmountWithSlippage.toFixed(tokenOutInfo.decimals),
        tokenOutInfo.decimals
      );
      
      return outputAmount;
    } catch (error) {
      console.error(`Error estimating output for ${tokenIn} -> ${tokenOut} on ${dexName}:`, error.message);
      return null;
    }
  }
  
  // Estimate slippage based on trade size and DEX
  estimateSlippage(tradeValueUsd, dexName) {
    // Basic slippage model - in a real system, this would be more sophisticated
    // and likely based on liquidity data from the DEX
    
    // Higher value trades experience more slippage
    let baseSlippage = 0;
    
    if (tradeValueUsd < 1000) {
      baseSlippage = 0.001; // 0.1% for small trades
    } else if (tradeValueUsd < 10000) {
      baseSlippage = 0.002; // 0.2% for medium trades
    } else if (tradeValueUsd < 100000) {
      baseSlippage = 0.005; // 0.5% for large trades
    } else {
      baseSlippage = 0.01; // 1% for very large trades
    }
    
    // Adjust based on DEX (some DEXes have more liquidity than others)
    const dexFactors = {
      'Uniswap V3': 1.0,    // Base factor
      'Curve': 0.8,         // Lower slippage due to stable coin focus
      'SushiSwap': 1.2      // Higher slippage due to potentially lower liquidity
    };
    
    // Apply DEX-specific factor
    const dexFactor = dexFactors[dexName] || 1.0;
    
    return baseSlippage * dexFactor;
  }
  
  // Helper method to find token symbol by address
  getTokenSymbol(address) {
    const token = this.config.tokens.find(t => t.address === address);
    return token ? token.symbol : address.substr(0, 6) + '...';
  }
  
  // Helper method to find token decimals by address
  getTokenDecimals(address) {
    const token = this.config.tokens.find(t => t.address === address);
    return token ? token.decimals : 18; // Default to 18 if not found
  }
  
  // Helper method to get full token info by address
  getTokenInfo(address) {
    return this.config.tokens.find(t => t.address === address);
  }
  
  // Execute a multi-path arbitrage opportunity using flash loans
  async executeMultiPathArbitrage(path, flashLoanContract) {
    if (!path || !path.path || path.path.length < 2) {
      throw new Error('Invalid arbitrage path');
    }
    
    console.log(`Executing multi-path arbitrage: ${path.path.map(this.getTokenSymbol.bind(this)).join(' -> ')}`);
    
    try {
      // Prepare the flash loan parameters
      const startToken = path.path[0];
      const startTokenInfo = this.getTokenInfo(startToken);
      
      if (!startTokenInfo) {
        throw new Error(`Token info not found for ${startToken}`);
      }
      
      // The amount to borrow in the flash loan
      const borrowAmount = ethers.parseUnits('10000', startTokenInfo.decimals); // Example amount
      
      // Encode the swap path for the flash loan contract
      const swapPath = path.dexPath.map(swap => ({
        tokenIn: swap.from,
        tokenOut: swap.to,
        dex: this.config.supportedDexes.findIndex(d => d.name === swap.dex)
      }));
      
      // Get the contract instance
      const contract = new ethers.Contract(
        flashLoanContract,
        [
          'function executeMultiPathArbitrage(address startToken, uint256 amount, tuple(address tokenIn, address tokenOut, uint8 dex)[] calldata path) external'
        ],
        this.provider.getSigner()
      );
      
      // Execute the transaction
      const tx = await contract.executeMultiPathArbitrage(
        startToken,
        borrowAmount,
        swapPath,
        {
          gasLimit: 3000000, // Adjust gas limit as needed
          maxFeePerGas: await this.getOptimalGasPrice()
        }
      );
      
      console.log(`Transaction submitted: ${tx.hash}`);
      
      // Wait for confirmation
      const receipt = await tx.wait();
      console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
      
      return {
        success: true,
        txHash: tx.hash,
        blockNumber: receipt.blockNumber
      };
    } catch (error) {
      console.error('Error executing multi-path arbitrage:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  // Get optimal gas price based on current network conditions
  async getOptimalGasPrice() {
    const feeData = await this.provider.getFeeData();
    const gasPrice = feeData.gasPrice;
    const gasPriceGwei = parseFloat(ethers.formatUnits(gasPrice, 'gwei'));
    
    // Skip if gas price is too high
    if (gasPriceGwei > this.config.maxGasPrice) {
      throw new Error(`Gas price too high: ${gasPriceGwei} gwei > ${this.config.maxGasPrice} gwei`);
    }
    
    // Add priority fee for EIP-1559 transactions
    if (this.config.priorityFee) {
      const priorityFeeWei = ethers.parseUnits(
        this.config.priorityFee.toString(),
        'gwei'
      );
      return gasPrice + priorityFeeWei;
    }
    
    return gasPrice;
  }
  
  // Check if a potential arbitrage opportunity is profitable after all costs
  async isProfitable(path, gasLimit = 1000000) {
    if (!path || !path.profit) {
      return { profitable: false, reason: 'No valid path or profit information' };
    }
    
    try {
      // Get token info
      const startToken = path.path[0];
      const startTokenInfo = this.getTokenInfo(startToken);
      
      if (!startTokenInfo) {
        return { profitable: false, reason: `Token info not found for ${startToken}` };
      }
      
      // 1. Calculate gas cost
      const { gasCostUsd } = await this.priceOracle.getGasPriceUsd(gasLimit);
      
      // 2. Calculate flash loan fee
      const borrowAmount = ethers.parseUnits('10000', startTokenInfo.decimals);
      const flashLoanFeePercent = this.config.flashLoanProviders.aave.fee || 0.09;
      const flashLoanFeeAmount = (borrowAmount * ethers.getBigInt(Math.floor(flashLoanFeePercent * 100))) / 10000n;
      
      // Convert flash loan fee to USD
      const startTokenPriceUsd = await this.priceOracle.getTokenPrice(startTokenInfo.symbol);
      if (!startTokenPriceUsd) {
        return { profitable: false, reason: `Could not get price for ${startTokenInfo.symbol}` };
      }
      
      const flashLoanFeeUsd = parseFloat(ethers.formatUnits(flashLoanFeeAmount, startTokenInfo.decimals)) * startTokenPriceUsd;
      
      // 3. Calculate expected profit in USD
      const profitTokenAmount = parseFloat(ethers.formatUnits(path.profit, startTokenInfo.decimals));
      const profitUsd = profitTokenAmount * startTokenPriceUsd;
      
      // 4. Calculate total costs
      const totalCostsUsd = gasCostUsd + flashLoanFeeUsd;
      
      // 5. Calculate net profit
      const netProfitUsd = profitUsd - totalCostsUsd;
      
      // Check if profit exceeds minimum threshold
      const isProfitable = netProfitUsd > this.config.minProfitUsd;
      
      return {
        profitable: isProfitable,
        profitUsd,
        gasCostUsd,
        flashLoanFeeUsd,
        totalCostsUsd,
        netProfitUsd,
        minProfitThreshold: this.config.minProfitUsd,
        reason: isProfitable ? 'Profitable' : `Net profit (${netProfitUsd.toFixed(2)} USD) below threshold (${this.config.minProfitUsd} USD)`
      };
    } catch (error) {
      console.error('Error checking profitability:', error);
      return {
        profitable: false,
        reason: `Error: ${error.message}`
      };
    }
  }
}

// Simple priority queue implementation
class PriorityQueue {
  constructor(comparator = (a, b) => a > b) {
    this.items = [];
    this.comparator = comparator;
  }
  
  enqueue(item) {
    let added = false;
    
    for (let i = 0; i < this.items.length; i++) {
      if (this.comparator(item, this.items[i])) {
        this.items.splice(i, 0, item);
        added = true;
        break;
      }
    }
    
    if (!added) {
      this.items.push(item);
    }
  }
  
  dequeue() {
    return this.items.shift();
  }
  
  isEmpty() {
    return this.items.length === 0;
  }
}

module.exports = {
  MultiPathArbitrageStrategy,
  PriorityQueue
};