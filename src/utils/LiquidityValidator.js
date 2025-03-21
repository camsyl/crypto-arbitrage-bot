// src/utils/LiquidityValidator.js
const { ethers } = require('ethers');

/**
 * LiquidityValidator validates DEX liquidity depth and detects unrealistic price differences
 */
class LiquidityValidator {
  constructor(provider, config) {
    this.provider = provider;
    this.config = config;
    this.tokenContracts = this._initializeTokenContracts();
    this.dexContracts = this._initializeDexContracts();
  }

  _initializeTokenContracts() {
    const tokenContracts = {};
    const ERC20_ABI = [
      'function balanceOf(address) view returns (uint256)',
      'function decimals() view returns (uint8)',
      'function totalSupply() view returns (uint256)'
    ];

    for (const token of this.config.tokens) {
      tokenContracts[token.address] = new ethers.Contract(token.address, ERC20_ABI, this.provider);
    }
    
    return tokenContracts;
  }

  _initializeDexContracts() {
    const dexContracts = {};
    
    // Initialize DEX-specific contracts for getting reserves
    const UNIV2_PAIR_ABI = [
      'function getReserves() view returns (uint112, uint112, uint32)',
      'function token0() view returns (address)',
      'function token1() view returns (address)'
    ];
    
    const UNIV3_POOL_ABI = [
      'function liquidity() view returns (uint128)',
      'function slot0() view returns (uint160, int24, uint16, uint16, uint16, uint8, bool)'
    ];
    
    dexContracts.uniswapV2Factory = new ethers.Contract(
      this.config.supportedDexes.find(d => d.name === 'SushiSwap')?.factoryAddress || '',
      ['function getPair(address, address) view returns (address)'],
      this.provider
    );
    
    dexContracts.uniswapV3Factory = new ethers.Contract(
      this.config.supportedDexes.find(d => d.name === 'Uniswap V3')?.factoryAddress || '',
      ['function getPool(address, address, uint24) view returns (address)'],
      this.provider
    );
    
    dexContracts.getPairContract = async (pairAddress) => {
      return new ethers.Contract(pairAddress, UNIV2_PAIR_ABI, this.provider);
    };
    
    dexContracts.getPoolContract = async (poolAddress) => {
      return new ethers.Contract(poolAddress, UNIV3_POOL_ABI, this.provider);
    };
    
    return dexContracts;
  }

  /**
   * Validates if there's sufficient liquidity for an arbitrage opportunity
   * @param {Object} opportunity - The arbitrage opportunity details
   * @param {Object} options - Validation options
   * @returns {Promise<{isValid: boolean, details: Object}>}
   */
  async validateOpportunity(opportunity, options = {}) {
    const {
      tokenA, 
      tokenB,
      amountIn, 
      buyDex, 
      sellDex
    } = opportunity;
    
    const tokenAInfo = this.config.tokens.find(t => t.symbol === tokenA);
    const tokenBInfo = this.config.tokens.find(t => t.symbol === tokenB);
    
    if (!tokenAInfo || !tokenBInfo) {
      return {
        isValid: false,
        details: { reason: 'Invalid token configuration' }
      };
    }
    
    const parsedAmountIn = ethers.parseUnits(
      amountIn.toString(), 
      tokenAInfo.decimals
    );
    
    try {
      // 1. Check buy side liquidity
      const buyLiquidity = await this.checkDexLiquidity(
        buyDex,
        tokenAInfo,
        tokenBInfo,
        parsedAmountIn
      );
      
      if (!buyLiquidity.isValid) {
        return {
          isValid: false,
          details: { 
            reason: `Insufficient buy-side liquidity: ${buyLiquidity.reason}`,
            dex: buyDex,
            side: 'buy'
          }
        };
      }
      
      // 2. Check sell side liquidity for the expected output amount
      const expectedBuyAmount = buyLiquidity.expectedOutput;
      
      const sellLiquidity = await this.checkDexLiquidity(
        sellDex,
        tokenBInfo,
        tokenAInfo,
        expectedBuyAmount,
        { slippageCheck: true }
      );
      
      if (!sellLiquidity.isValid) {
        return {
          isValid: false,
          details: { 
            reason: `Insufficient sell-side liquidity: ${sellLiquidity.reason}`,
            dex: sellDex,
            side: 'sell'
          }
        };
      }
      
      // 3. Check if the price difference is realistic (not a sandwich attack vector)
      const priceCheck = this.validatePriceDifference(
        tokenAInfo,
        tokenBInfo,
        parsedAmountIn,
        expectedBuyAmount,
        sellLiquidity.expectedOutput
      );
      
      if (!priceCheck.isValid) {
        return {
          isValid: false,
          details: { 
            reason: `Unrealistic price difference: ${priceCheck.reason}`,
            priceDeviation: priceCheck.deviation
          }
        };
      }
      
      // 4. Calculate profitability after all costs
      const profitability = await this.calculateProfitability(
        tokenAInfo,
        parsedAmountIn,
        sellLiquidity.expectedOutput,
        options.gasLimit || 500000
      );
      
      return {
        isValid: profitability.isProfitable,
        details: {
          buyAmount: ethers.formatUnits(expectedBuyAmount, tokenBInfo.decimals),
          sellAmount: ethers.formatUnits(sellLiquidity.expectedOutput, tokenAInfo.decimals),
          reserveRatioBuy: buyLiquidity.reserveRatio,
          reserveRatioSell: sellLiquidity.reserveRatio,
          priceImpactBuy: buyLiquidity.priceImpact,
          priceImpactSell: sellLiquidity.priceImpact,
          profit: ethers.formatUnits(profitability.profit, tokenAInfo.decimals),
          profitUsd: profitability.profitUsd,
          gasCostUsd: profitability.gasCostUsd,
          netProfitUsd: profitability.netProfitUsd,
          flashLoanFeeUsd: profitability.flashLoanFeeUsd,
          isProfitable: profitability.isProfitable,
          reason: profitability.isProfitable ? 'Profitable' : 'Not profitable after costs'
        }
      };
    } catch (error) {
      return {
        isValid: false,
        details: { 
          reason: `Error validating opportunity: ${error.message}`,
          error: error
        }
      };
    }
  }

  /**
   * Checks liquidity depth for a specific DEX
   * @param {string} dexName - The name of the DEX to check
   * @param {Object} tokenIn - The input token info
   * @param {Object} tokenOut - The output token info
   * @param {BigNumber} amountIn - The input amount
   * @param {Object} options - Additional options
   * @returns {Promise<{isValid: boolean, reason: string, expectedOutput: BigNumber, ...}>}
   */
  async checkDexLiquidity(dexName, tokenIn, tokenOut, amountIn, options = {}) {
    try {
      // Get the real reserves from the DEX
      const reserves = await this.getDexReserves(dexName, tokenIn, tokenOut);
      
      if (!reserves.success) {
        return {
          isValid: false,
          reason: reserves.error
        };
      }
      
      // Calculate the reserve ratio (trade size to total liquidity)
      const reserveRatio = Number(amountIn * 10000n / reserves.reserveIn) / 100;
      
      // Check if the trade size is too large compared to reserves
      // Usually >5% of reserves causes significant slippage
      const MAX_RESERVE_RATIO = options.maxReserveRatio || 5; // 5%
      
      if (reserveRatio > MAX_RESERVE_RATIO) {
        return {
          isValid: false,
          reason: `Trade size (${reserveRatio.toFixed(2)}%) exceeds maximum safe ratio (${MAX_RESERVE_RATIO}%)`,
          reserveRatio
        };
      }
      
      // Calculate expected output based on reserves (simplified)
      let expectedOutput;
      let priceImpact;
      
      if (dexName === 'Uniswap V3') {
        // Uniswap V3 calculation is complex - use an approximation or the quoter
        // For now we'll use the reserves.expectedOutput that comes from our call
        expectedOutput = reserves.expectedOutput;
        
        // Calculate approximate price impact
        const spotPrice = reserves.reserveOut * 10000n / reserves.reserveIn;
        const executionPrice = expectedOutput * 10000n / amountIn;
        priceImpact = Number((spotPrice - executionPrice) * 10000n / spotPrice) / 100;
      } else {
        // For Uniswap V2, SushiSwap, etc. using the constant product formula
        const amountInWithFee = amountIn * 997n; // 0.3% fee
        const numerator = amountInWithFee * reserves.reserveOut;
        const denominator = reserves.reserveIn * 1000n + amountInWithFee;
        expectedOutput = numerator / denominator;
        
        // Calculate price impact
        const spotPrice = reserves.reserveOut * 10000n / reserves.reserveIn;
        const executionPrice = expectedOutput * 10000n / amountIn;
        priceImpact = Number((spotPrice - executionPrice) * 10000n / spotPrice) / 100;
      }
      
      // If doing a slippage check, verify the output is reasonable
      if (options.slippageCheck) {
        const slippageTolerance = options.slippageTolerance || this.config.slippageTolerance || 0.5;
        const minAcceptableOutput = amountIn * reserves.swapRate * (100n - BigInt(Math.floor(slippageTolerance * 100))) / 10000n;
        
        if (expectedOutput < minAcceptableOutput) {
          return {
            isValid: false,
            reason: `High slippage detected: expected ${ethers.formatUnits(expectedOutput, tokenOut.decimals)}, min acceptable: ${ethers.formatUnits(minAcceptableOutput, tokenOut.decimals)}`,
            expectedOutput,
            minAcceptableOutput,
            slippage: slippageTolerance
          };
        }
      }
      
      // Check price impact - reject if it's too high
      const MAX_PRICE_IMPACT = options.maxPriceImpact || 3; // 3%
      
      if (priceImpact > MAX_PRICE_IMPACT) {
        return {
          isValid: false,
          reason: `Price impact too high: ${priceImpact.toFixed(2)}% > ${MAX_PRICE_IMPACT}%`,
          priceImpact
        };
      }
      
      return {
        isValid: true,
        expectedOutput,
        reserveIn: reserves.reserveIn,
        reserveOut: reserves.reserveOut,
        reserveRatio,
        priceImpact
      };
    } catch (error) {
      return {
        isValid: false,
        reason: `Error checking DEX liquidity: ${error.message}`
      };
    }
  }

  /**
   * Gets the actual reserves for a DEX pair
   * @param {string} dexName - The DEX name
   * @param {Object} tokenA - First token info
   * @param {Object} tokenB - Second token info
   * @returns {Promise<{success: boolean, reserveIn: BigNumber, reserveOut: BigNumber, ...}>}
   */
  async getDexReserves(dexName, tokenA, tokenB) {
    try {
      if (dexName === 'Uniswap V3') {
        // For Uniswap V3, we need to check each fee tier
        const feeTiers = [100, 500, 3000, 10000]; // 0.01%, 0.05%, 0.3%, 1%
        let bestLiquidity = 0n;
        let bestReserveIn = 0n;
        let bestReserveOut = 0n;
        let bestExpectedOutput = 0n;
        let bestSwapRate = 0n;
        
        for (const feeTier of feeTiers) {
          try {
            const poolAddress = await this.dexContracts.uniswapV3Factory.getPool(
              tokenA.address,
              tokenB.address,
              feeTier
            );
            
            if (poolAddress === ethers.ZeroAddress) continue;
            
            const poolContract = await this.dexContracts.getPoolContract(poolAddress);
            const liquidity = await poolContract.liquidity();
            
            // This is a simplified approach - in practice, you need to consider active ranges
            if (liquidity > bestLiquidity) {
              bestLiquidity = liquidity;
              
              // For a more precise calculation, you'd use the Uniswap SDK or quoter
              // But for estimation, we can use approximated reserves
              const slot0 = await poolContract.slot0();
              const sqrtPriceX96 = slot0[0];
              
              // Simplified conversion of sqrtPriceX96 to token ratio
              const priceRatio = Number(sqrtPriceX96 * sqrtPriceX96) / (2n ** 192n);
              
              // Estimate reserves (this is an approximation)
              const effectiveLiquidity = Number(liquidity);
              
              if (BigInt(tokenA.address) < BigInt(tokenB.address)) {
                bestReserveIn = BigInt(Math.floor(effectiveLiquidity / Math.sqrt(priceRatio)));
                bestReserveOut = BigInt(Math.floor(effectiveLiquidity * Math.sqrt(priceRatio)));
              } else {
                bestReserveOut = BigInt(Math.floor(effectiveLiquidity / Math.sqrt(priceRatio)));
                bestReserveIn = BigInt(Math.floor(effectiveLiquidity * Math.sqrt(priceRatio)));
              }
              
              // Calculate rate
              bestSwapRate = bestReserveOut * 10000n / bestReserveIn;
              
              // Estimate output (very simplified)
              const amountIn = ethers.parseUnits('1', tokenA.decimals);
              bestExpectedOutput = amountIn * bestReserveOut / bestReserveIn;
            }
          } catch (error) {
            console.error(`Error checking Uniswap V3 at fee tier ${feeTier/10000}%:`, error.message);
          }
        }
        
        if (bestLiquidity === 0n) {
          return {
            success: false,
            error: 'No Uniswap V3 liquidity found for pair'
          };
        }
        
        return {
          success: true,
          reserveIn: bestReserveIn,
          reserveOut: bestReserveOut,
          liquidity: bestLiquidity,
          swapRate: bestSwapRate,
          expectedOutput: bestExpectedOutput
        };
      } else if (dexName === 'SushiSwap') {
        // For SushiSwap and other Uniswap V2 forks
        const pairAddress = await this.dexContracts.uniswapV2Factory.getPair(
          tokenA.address,
          tokenB.address
        );
        
        if (pairAddress === ethers.ZeroAddress) {
          return {
            success: false,
            error: 'No SushiSwap pair found'
          };
        }
        
        const pairContract = await this.dexContracts.getPairContract(pairAddress);
        const reserves = await pairContract.getReserves();
        const token0 = await pairContract.token0();
        
        // Determine which token is which in the pair
        const isToken0 = tokenA.address.toLowerCase() === token0.toLowerCase();
        const reserveIn = isToken0 ? reserves[0] : reserves[1];
        const reserveOut = isToken0 ? reserves[1] : reserves[0];
        
        // Calculate rate
        const swapRate = reserveOut * 10000n / reserveIn;
        
        return {
          success: true,
          reserveIn,
          reserveOut,
          swapRate,
          pairAddress
        };
      } else {
        return {
          success: false,
          error: `Unsupported DEX: ${dexName}`
        };
      }
    } catch (error) {
      return {
        success: false,
        error: `Error getting reserves: ${error.message}`
      };
    }
  }

  /**
   * Validates that the price difference is realistic and not due to an attack
   * @param {Object} tokenA - The first token info
   * @param {Object} tokenB - The second token info
   * @param {BigNumber} amountIn - The input amount
   * @param {BigNumber} buyAmount - The amount received from the first swap
   * @param {BigNumber} sellAmount - The amount received from the second swap
   * @returns {{isValid: boolean, reason?: string, deviation?: number}}
   */
  validatePriceDifference(tokenA, tokenB, amountIn, buyAmount, sellAmount) {
    // Calculate the effective rates
    const buyRate = Number(buyAmount * 10000n / amountIn) / 10000;
    const sellRate = Number(sellAmount * 10000n / buyAmount) / 10000;
    
    // Calculate percentage deviation
    const deviation = Math.abs((sellRate * buyRate - 1) * 100);
    
    // Define what's "too good to be true" based on token types
    let maxAllowedDeviation = 1.5; // Default: 1.5%
    
    // For stablecoins, the deviation should be much smaller
    const stablecoins = ['USDC', 'USDT', 'DAI', 'BUSD', 'TUSD', 'USDN', 'FRAX'];
    const isStablePair = stablecoins.includes(tokenA.symbol) && stablecoins.includes(tokenB.symbol);
    
    if (isStablePair) {
      maxAllowedDeviation = 0.25; // 0.25% for stablecoin pairs
    }
    // For major tokens, set appropriate thresholds
    else if (['WETH', 'WBTC'].includes(tokenA.symbol) || ['WETH', 'WBTC'].includes(tokenB.symbol)) {
      maxAllowedDeviation = 0.75; // 0.75% for major pairs
    }
    
    if (deviation > maxAllowedDeviation) {
      return {
        isValid: false,
        reason: `Price deviation (${deviation.toFixed(2)}%) exceeds maximum allowed (${maxAllowedDeviation}%) for this token pair`,
        deviation
      };
    }
    
    return {
      isValid: true,
      deviation
    };
  }

  /**
   * Calculates whether an arbitrage is profitable after all costs
   * @param {Object} token - The token info
   * @param {BigNumber} amountIn - The input amount
   * @param {BigNumber} amountOut - The output amount
   * @param {number} gasLimit - Estimated gas units
   * @returns {Promise<{isProfitable: boolean, profit: BigNumber, ...}>}
   */
  async calculateProfitability(token, amountIn, amountOut, gasLimit) {
    try {
      // Calculate raw profit
      const profit = amountOut > amountIn ? amountOut - amountIn : 0n;
      
      if (profit === 0n) {
        return {
          isProfitable: false,
          profit: 0n,
          profitUsd: 0,
          reason: 'No profit'
        };
      }
      
      // Calculate flash loan fee
      const flashLoanFee = amountIn * 9n / 10000n; // Aave fee: 0.09%
      
      // Get token price in USD (simplified - in production use an oracle)
      const tokenPriceUsd = 1.0; // Placeholder - replace with actual price
      
      // Convert profit to USD
      const profitUsd = Number(ethers.formatUnits(profit, token.decimals)) * tokenPriceUsd;
      const flashLoanFeeUsd = Number(ethers.formatUnits(flashLoanFee, token.decimals)) * tokenPriceUsd;
      
      // Estimate gas cost
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice;
      const gasCostWei = gasPrice * BigInt(gasLimit);
      const gasCostEth = Number(ethers.formatEther(gasCostWei));
      
      // Convert gas cost to USD (assuming ETH price is $2000)
      const ethPriceUsd = 2000;
      const gasCostUsd = gasCostEth * ethPriceUsd;
      
      // Calculate total costs
      const totalCostsUsd = flashLoanFeeUsd + gasCostUsd;
      
      // Calculate net profit
      const netProfitUsd = profitUsd - totalCostsUsd;
      
      // Check if profit exceeds minimum threshold
      const minProfitUsd = this.config.minProfitUsd || 10;
      const isProfitable = netProfitUsd > minProfitUsd;
      
      return {
        isProfitable,
        profit,
        profitUsd,
        flashLoanFee,
        flashLoanFeeUsd,
        gasCostWei,
        gasCostEth,
        gasCostUsd,
        totalCostsUsd,
        netProfitUsd,
        reason: isProfitable ? 
          'Profitable' : 
          `Net profit ($${netProfitUsd.toFixed(2)}) below threshold ($${minProfitUsd})`
      };
    } catch (error) {
      return {
        isProfitable: false,
        profit: 0n,
        reason: `Error calculating profitability: ${error.message}`
      };
    }
  }
}

module.exports = LiquidityValidator;