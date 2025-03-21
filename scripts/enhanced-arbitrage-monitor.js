// scripts/enhanced-arbitrage-monitor.js
const { ethers } = require("hardhat");

// Token addresses - expanded list including tokens known for inefficiencies
const TOKENS = {
  // Major tokens
  WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
  USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  
  // DeFi tokens - often more volatile
  AAVE: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9",
  UNI: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
  COMP: "0xc00e94Cb662C3520282E6f5717214004A7f26888",
  MKR: "0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2",
  SNX: "0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F",
  
  // Stablecoins with different mechanisms
  FRAX: "0x853d955aCEf822Db058eb8505911ED77F175b99e",
  LUSD: "0x5f98805A4E8be255a32880FDeC7F6728C6568bA0",
  GUSD: "0x056Fd409E1d7A124BD7017459dFEa2F387b6d5Cd",
  
  // Liquid staking tokens - often different pricing mechanisms
  STETH: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",
  RETH: "0xae78736Cd615f374D3085123A210448E74Fc6393",
  
  // Wrapped assets
  WSTETH: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
  HBTC: "0x0316EB71485b0Ab14103307bf65a021042c6d380",
  
  // Tokens with lower liquidity
  BAL: "0xba100000625a3754423978a60c9317c58a424e3D",
  SUSHI: "0x6B3595068778DD592e39A122f4f5a5cF09C90fE2",
  CVX: "0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B"
};

// DEX addresses
const DEX = {
  UniswapV3Router: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
  UniswapV3Quoter: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",
  SushiswapRouter: "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F",
  CurveAddressProvider: "0x0000000022D53366457F9d5E68Ec105046FC4383"
};

// ABIs
const UniswapV3QuoterABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)"
];

const SushiswapRouterABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)"
];

const CurveAddressProviderABI = [
  "function get_registry() external view returns (address)",
  "function get_address(uint256 id) external view returns (address)"
];

const CurveRegistryABI = [
  "function find_pool_for_coins(address _from, address _to) external view returns (address)",
  "function get_coin_indices(address _pool, address _from, address _to) external view returns (int128, int128, bool)"
];

const CurvePoolABI = [
  "function get_dy(int128 i, int128 j, uint256 dx) external view returns (uint256)"
];

const ERC20ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

// DEX enum for the FlashLoanArbitrage contract
const DEX_ENUM = {
  Uniswap: 0,
  Sushiswap: 1,
  Curve: 2,
  Balancer: 3
};

// Fee tiers for Uniswap V3
const UniswapV3FeeTiers = [100, 500, 3000, 10000]; // 0.01%, 0.05%, 0.3%, 1%

async function main() {
  console.log("\n🔍 STARTING ENHANCED ARBITRAGE OPPORTUNITY FINDER\n");
  
  // Ensure we're on a forked network
  const networkName = hre.network.name;
  if (!networkName.includes("hardhat")) {
    console.error("❌ This script must be run on a hardhat forked network");
    process.exit(1);
  }
  
  const blockNumber = await ethers.provider.getBlockNumber();
  console.log(`Running on ${networkName} at block ${blockNumber}`);
  
  // Get signers
  const [signer] = await ethers.getSigners();
  console.log(`Using signer: ${signer.address}`);
  
  // Initialize DEX contracts
  console.log("\n🔄 Initializing DEX contracts...");
  const uniswapQuoter = new ethers.Contract(DEX.UniswapV3Quoter, UniswapV3QuoterABI, signer);
  const sushiswapRouter = new ethers.Contract(DEX.SushiswapRouter, SushiswapRouterABI, signer);
  
  // Initialize Curve contracts
  const curveAddressProvider = new ethers.Contract(DEX.CurveAddressProvider, CurveAddressProviderABI, signer);
  const curveRegistryAddress = await curveAddressProvider.get_registry();
  const curveRegistry = new ethers.Contract(curveRegistryAddress, CurveRegistryABI, signer);
  
  // Initialize token info
  console.log("\n💰 Loading token information...");
  const tokenInfo = {};
  
  for (const [symbol, address] of Object.entries(TOKENS)) {
    try {
      const token = new ethers.Contract(address, ERC20ABI, signer);
      try {
        const decimals = await token.decimals();
        let symbolValue = symbol;
        try {
          symbolValue = await token.symbol();
        } catch {
          // Keep the key as symbol if symbol() call fails
        }
        tokenInfo[symbol] = { address, decimals, symbol: symbolValue };
        console.log(`- ${symbol}: ${address} (${decimals} decimals)`);
      } catch (error) {
        console.log(`Could not get decimals for ${symbol}, skipping this token`);
      }
    } catch (error) {
      console.log(`Error initializing ${symbol} at ${address}, skipping this token`);
    }
  }
  
  // Check all possible token pairs
  console.log("\n📊 Checking for arbitrage opportunities...");
  
  // Build token pair combinations
  const tokenSymbols = Object.keys(tokenInfo);
  const tokenPairs = [];
  
  for (let i = 0; i < tokenSymbols.length; i++) {
    for (let j = i + 1; j < tokenSymbols.length; j++) {
      // Skip pairs where we already know there's no liquidity or high correlation
      const pair = {
        tokenA: tokenSymbols[i],
        tokenB: tokenSymbols[j]
      };
      
      // Check if both tokens have info
      if (tokenInfo[pair.tokenA] && tokenInfo[pair.tokenB]) {
        tokenPairs.push(pair);
      }
    }
  }
  
  console.log(`Generated ${tokenPairs.length} token pairs to check`);
  
  // Test amounts for different tokens (smaller amounts for initial testing)
  const getTestAmounts = (symbol) => {
    const info = tokenInfo[symbol];
    if (!info) return [];
    
    // Scale amounts based on token type
    if (symbol === 'WETH') {
      return [
        ethers.parseUnits("0.1", info.decimals),
        ethers.parseUnits("1", info.decimals),
        ethers.parseUnits("5", info.decimals)
      ];
    } else if (symbol === 'WBTC') {
      return [
        ethers.parseUnits("0.01", info.decimals),
        ethers.parseUnits("0.1", info.decimals),
        ethers.parseUnits("0.5", info.decimals)
      ];
    } else if (['USDC', 'USDT', 'DAI', 'LUSD', 'GUSD', 'FRAX'].includes(symbol)) {
      return [
        ethers.parseUnits("100", info.decimals),
        ethers.parseUnits("1000", info.decimals),
        ethers.parseUnits("10000", info.decimals)
      ];
    } else {
      // For other tokens, use medium amounts
      return [
        ethers.parseUnits("10", info.decimals),
        ethers.parseUnits("100", info.decimals),
        ethers.parseUnits("1000", info.decimals)
      ];
    }
  };
  
  // Find opportunities
  const opportunities = [];
  const trianglePaths = [];
  
  // Check direct token pairs
  for (const pair of tokenPairs) {
    const tokenA = pair.tokenA;
    const tokenB = pair.tokenB;
    
    if (!tokenInfo[tokenA] || !tokenInfo[tokenB]) continue;
    
    console.log(`\nChecking ${tokenA}/${tokenB} pair...`);
    
    // Get test amounts for this token
    const testAmountsForToken = getTestAmounts(tokenA);
    if (testAmountsForToken.length === 0) continue;
    
    for (const amount of testAmountsForToken) {
      try {
        const amountFormatted = ethers.formatUnits(amount, tokenInfo[tokenA].decimals);
        console.log(`\nTesting with ${amountFormatted} ${tokenA}...`);
        
        // Check Uniswap V3 (across all fee tiers)
        let bestUniswapRate = 0n;
        let bestFeeTier = 0;
        
        for (const feeTier of UniswapV3FeeTiers) {
          try {
            const uniswapOutput = await uniswapQuoter.quoteExactInputSingle.staticCall(
              tokenInfo[tokenA].address,
              tokenInfo[tokenB].address,
              feeTier,
              amount,
              0
            );
            
            if (uniswapOutput > bestUniswapRate) {
              bestUniswapRate = uniswapOutput;
              bestFeeTier = feeTier;
            }
          } catch (error) {
            // Skip this fee tier if no liquidity
          }
        }
        
        // Check Sushiswap
        let sushiswapOutput = 0n;
        try {
          const path = [tokenInfo[tokenA].address, tokenInfo[tokenB].address];
          const amounts = await sushiswapRouter.getAmountsOut(amount, path);
          sushiswapOutput = amounts[1];
        } catch (error) {
          // Skip if no liquidity
        }
        
        // Check Curve
        let curveOutput = 0n;
        try {
          const poolAddress = await curveRegistry.find_pool_for_coins(
            tokenInfo[tokenA].address,
            tokenInfo[tokenB].address
          );
          
          if (poolAddress && poolAddress !== ethers.ZeroAddress) {
            const indices = await curveRegistry.get_coin_indices(
              poolAddress,
              tokenInfo[tokenA].address,
              tokenInfo[tokenB].address
            );
            
            const i = indices[0];
            const j = indices[1];
            
            const curvePool = new ethers.Contract(poolAddress, CurvePoolABI, signer);
            curveOutput = await curvePool.get_dy(i, j, amount);
          }
        } catch (error) {
          // Skip if no Curve pool or error
        }
        
        // Format outputs and check for opportunities
        if (bestUniswapRate > 0n || sushiswapOutput > 0n || curveOutput > 0n) {
          console.log(`Liquidity found for ${tokenA}/${tokenB}:`);
          
          if (bestUniswapRate > 0n) {
            const uniswapFormatted = ethers.formatUnits(bestUniswapRate, tokenInfo[tokenB].decimals);
            console.log(`  Uniswap V3 (${bestFeeTier/10000}%): ${uniswapFormatted} ${tokenB}`);
          }
          
          if (sushiswapOutput > 0n) {
            const sushiswapFormatted = ethers.formatUnits(sushiswapOutput, tokenInfo[tokenB].decimals);
            console.log(`  Sushiswap: ${sushiswapFormatted} ${tokenB}`);
          }
          
          if (curveOutput > 0n) {
            const curveFormatted = ethers.formatUnits(curveOutput, tokenInfo[tokenB].decimals);
            console.log(`  Curve: ${curveFormatted} ${tokenB}`);
          }
          
          // Check for arbitrage opportunities between DEXes
          const rates = [];
          if (bestUniswapRate > 0n) rates.push({ dex: "Uniswap", rate: bestUniswapRate, feeTier: bestFeeTier });
          if (sushiswapOutput > 0n) rates.push({ dex: "Sushiswap", rate: sushiswapOutput });
          if (curveOutput > 0n) rates.push({ dex: "Curve", rate: curveOutput });
          
          // Sort by rate, highest first
          rates.sort((a, b) => b.rate > a.rate ? 1 : -1);
          
          // If we have at least 2 DEXes with liquidity
          if (rates.length >= 2) {
            const bestRate = rates[0];
            const secondBestRate = rates[1];
            
            // Calculate price difference
            const priceDiff = (Number(bestRate.rate - secondBestRate.rate) * 100) / Number(secondBestRate.rate);
            
            console.log(`  Price difference: ${priceDiff.toFixed(4)}%`);
            
            if (priceDiff > 0.5) { // At least 0.5% difference
              console.log(`  🔥 OPPORTUNITY: Buy on ${secondBestRate.dex}, sell on ${bestRate.dex}`);
              
              // Add to opportunities list
              opportunities.push({
                tokenA,
                tokenB,
                direction: `${secondBestRate.dex} → ${bestRate.dex}`,
                amountIn: amountFormatted,
                tokenADecimals: tokenInfo[tokenA].decimals,
                spreadPercentage: priceDiff,
                buyDex: secondBestRate.dex,
                sellDex: bestRate.dex,
                buyRate: ethers.formatUnits(secondBestRate.rate, tokenInfo[tokenB].decimals),
                sellRate: ethers.formatUnits(bestRate.rate, tokenInfo[tokenB].decimals)
              });
              
              // Check if this pair can be used in a triangle arbitrage
              if (bestRate.rate > secondBestRate.rate) {
                // This pair has profitable direct arbitrage, try to find a third token
                // for triangular arbitrage
                for (const thirdToken of tokenSymbols) {
                  if (thirdToken !== tokenA && thirdToken !== tokenB && tokenInfo[thirdToken]) {
                    // Try tokenA -> tokenB -> thirdToken -> tokenA
                    trianglePaths.push({
                      path: [tokenA, tokenB, thirdToken, tokenA],
                      startAmount: amount,
                      spread: priceDiff
                    });
                  }
                }
              }
            }
          }
        } else {
          console.log(`  No liquidity found for ${tokenA}/${tokenB}`);
        }
      } catch (error) {
        console.error(`  Error checking ${tokenA}/${tokenB}:`, error.message);
      }
    }
  }
  
  // Report findings
  console.log("\n📋 ARBITRAGE OPPORTUNITIES SUMMARY");
  
  if (opportunities.length === 0) {
    console.log("No direct arbitrage opportunities found");
  } else {
    // Sort by spread percentage
    opportunities.sort((a, b) => b.spreadPercentage - a.spreadPercentage);
    
    console.log(`Found ${opportunities.length} potential opportunities:`);
    for (let i = 0; i < Math.min(10, opportunities.length); i++) {
      const opp = opportunities[i];
      console.log(`\n${i+1}. ${opp.tokenA}/${opp.tokenB} - ${opp.direction}`);
      console.log(`   Amount: ${opp.amountIn} ${opp.tokenA}`);
      console.log(`   Spread: ${opp.spreadPercentage.toFixed(4)}%`);
      console.log(`   ${opp.buyDex} rate: ${opp.buyRate} ${opp.tokenB}`);
      console.log(`   ${opp.sellDex} rate: ${opp.sellRate} ${opp.tokenB}`);
    }
    
    if (opportunities.length > 10) {
      console.log(`\n... and ${opportunities.length - 10} more opportunities`);
    }
    
    // Recommend the best opportunity
    const best = opportunities[0];
    console.log(`\n🏆 BEST OPPORTUNITY: ${best.tokenA}/${best.tokenB} - ${best.direction}`);
    console.log(`   Amount: ${best.amountIn} ${best.tokenA}`);
    console.log(`   Spread: ${best.spreadPercentage.toFixed(4)}%`);
  }
  
  // Now check the triangle paths
  console.log("\n🔍 CHECKING TRIANGLE ARBITRAGE PATHS");
  console.log(`Generated ${trianglePaths.length} potential triangle paths to check`);
  
  const profitableTriangles = [];
  
  for (let i = 0; i < Math.min(10, trianglePaths.length); i++) {
    const trianglePath = trianglePaths[i];
    console.log(`\nChecking path: ${trianglePath.path.join(' → ')}`);
    
    try {
      let currentAmount = trianglePath.startAmount;
      let pathDetails = [];
      let successful = true;
      
      // Simulate the path
      for (let j = 0; j < trianglePath.path.length - 1; j++) {
        const tokenFrom = trianglePath.path[j];
        const tokenTo = trianglePath.path[j+1];
        
        if (!tokenInfo[tokenFrom] || !tokenInfo[tokenTo]) {
          successful = false;
          break;
        }
        
        // Try to find the best rate
        let bestRate = 0n;
        let bestDex = "";
        
        // Check Uniswap
        try {
          let bestUniswapRate = 0n;
          let bestFeeTier = 0;
          
          for (const feeTier of UniswapV3FeeTiers) {
            try {
              const output = await uniswapQuoter.quoteExactInputSingle.staticCall(
                tokenInfo[tokenFrom].address,
                tokenInfo[tokenTo].address,
                feeTier,
                currentAmount,
                0
              );
              
              if (output > bestUniswapRate) {
                bestUniswapRate = output;
                bestFeeTier = feeTier;
              }
            } catch (error) {
              // Skip this fee tier
            }
          }
          
          if (bestUniswapRate > bestRate) {
            bestRate = bestUniswapRate;
            bestDex = `Uniswap (${bestFeeTier/10000}%)`;
          }
        } catch (error) {
          // Skip Uniswap
        }
        
        // Check Sushiswap
        try {
          const path = [tokenInfo[tokenFrom].address, tokenInfo[tokenTo].address];
          const amounts = await sushiswapRouter.getAmountsOut(currentAmount, path);
          const sushiRate = amounts[1];
          
          if (sushiRate > bestRate) {
            bestRate = sushiRate;
            bestDex = "Sushiswap";
          }
        } catch (error) {
          // Skip Sushiswap
        }
        
        // If we found a rate, add to path details
        if (bestRate > 0n) {
          pathDetails.push({
            from: tokenFrom,
            to: tokenTo,
            amountIn: ethers.formatUnits(currentAmount, tokenInfo[tokenFrom].decimals),
            amountOut: ethers.formatUnits(bestRate, tokenInfo[tokenTo].decimals),
            dex: bestDex
          });
          
          // Update current amount for next step
          currentAmount = bestRate;
        } else {
          console.log(`  No liquidity for ${tokenFrom} → ${tokenTo}`);
          successful = false;
          break;
        }
      }
      
      // If we completed the path successfully
      if (successful) {
        // Calculate profit/loss percentage
        const finalAmount = currentAmount;
        const startAmount = trianglePath.startAmount;
        const profitAmount = finalAmount - startAmount;
        const profitPercentage = Number(profitAmount * 10000n / startAmount) / 100;
        
        // Show path details
        console.log(`  Path execution:`);
        pathDetails.forEach(step => {
          console.log(`    ${step.from} → ${step.to}: ${step.amountIn} → ${step.amountOut} (${step.dex})`);
        });
        
        // Show profit information
        const startFormatted = ethers.formatUnits(startAmount, tokenInfo[trianglePath.path[0]].decimals);
        const finalFormatted = ethers.formatUnits(finalAmount, tokenInfo[trianglePath.path[0]].decimals);
        const profitFormatted = ethers.formatUnits(profitAmount, tokenInfo[trianglePath.path[0]].decimals);
        
        console.log(`  Start: ${startFormatted} ${trianglePath.path[0]}`);
        console.log(`  End: ${finalFormatted} ${trianglePath.path[0]}`);
        
        if (profitAmount > 0n) {
          console.log(`  ✅ Profit: ${profitFormatted} ${trianglePath.path[0]} (${profitPercentage.toFixed(4)}%)`);
          
          // Calculate flash loan fee
          const flashLoanFee = startAmount * 9n / 10000n; // 0.09%
          const flashLoanFeeFormatted = ethers.formatUnits(flashLoanFee, tokenInfo[trianglePath.path[0]].decimals);
          console.log(`  Flash loan fee: ${flashLoanFeeFormatted} ${trianglePath.path[0]}`);
          
          // Net profit after flash loan fee
          const netProfit = profitAmount - flashLoanFee;
          const netProfitFormatted = ethers.formatUnits(netProfit, tokenInfo[trianglePath.path[0]].decimals);
          const netProfitPercentage = Number(netProfit * 10000n / startAmount) / 100;
          
          if (netProfit > 0n) {
            console.log(`  ✅ Net profit: ${netProfitFormatted} ${trianglePath.path[0]} (${netProfitPercentage.toFixed(4)}%)`);
            
            // Add to profitable triangles
            profitableTriangles.push({
              path: trianglePath.path,
              startAmount: startFormatted,
              profit: profitFormatted,
              profitPercentage,
              netProfit: netProfitFormatted,
              netProfitPercentage,
              details: pathDetails
            });
          } else {
            console.log(`  ❌ Not profitable after flash loan fee: ${netProfitFormatted} ${trianglePath.path[0]}`);
          }
        } else {
          console.log(`  ❌ Loss: ${profitFormatted} ${trianglePath.path[0]} (${profitPercentage.toFixed(4)}%)`);
        }
      }
    } catch (error) {
      console.error(`  Error checking triangle path:`, error.message);
    }
  }
  
  // Report triangle arbitrage findings
  console.log("\n📐 TRIANGLE ARBITRAGE SUMMARY");
  
  if (profitableTriangles.length === 0) {
    console.log("No profitable triangle arbitrage paths found");
  } else {
    // Sort by net profit percentage
    profitableTriangles.sort((a, b) => b.netProfitPercentage - a.netProfitPercentage);
    
    console.log(`Found ${profitableTriangles.length} profitable triangle arbitrage opportunities:`);
    
    for (let i = 0; i < profitableTriangles.length; i++) {
      const triangle = profitableTriangles[i];
      console.log(`\n${i+1}. ${triangle.path.join(' → ')}`);
      console.log(`   Start amount: ${triangle.startAmount} ${triangle.path[0]}`);
      console.log(`   Net profit: ${triangle.netProfit} ${triangle.path[0]} (${triangle.netProfitPercentage.toFixed(4)}%)`);
      console.log(`   Path details:`);
      
      triangle.details.forEach((step, index) => {
        console.log(`   ${index+1}. ${step.from} → ${step.to}: ${step.amountIn} → ${step.amountOut} (${step.dex})`);
      });
    }
    
    // Recommend the best triangle opportunity
    const bestTriangle = profitableTriangles[0];
    console.log(`\n🏆 BEST TRIANGLE ARBITRAGE: ${bestTriangle.path.join(' → ')}`);
    console.log(`   Start amount: ${bestTriangle.startAmount} ${bestTriangle.path[0]}`);
    console.log(`   Net profit: ${bestTriangle.netProfit} ${bestTriangle.path[0]} (${bestTriangle.netProfitPercentage.toFixed(4)}%)`);
  }
  
  console.log("\n🏁 ENHANCED ARBITRAGE OPPORTUNITY FINDER COMPLETE");
}

// Execute the script
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });