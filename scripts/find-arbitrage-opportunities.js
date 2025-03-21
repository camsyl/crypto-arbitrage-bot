// scripts/find-arbitrage-opportunities.js
const hre = require("hardhat");
const { ethers } = require("hardhat");
const { getRpcUrl } = require('../src/utils/rpc-provider');

// Token addresses
const TOKENS = {
  WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599"
};

// DEX addresses
const DEX = {
  UniswapV3Router: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
  UniswapV3Quoter: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",
  SushiswapRouter: "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F"
};

// ABIs
const UniswapV3QuoterABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)"
];

const SushiswapRouterABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)"
];

const ERC20ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

// DEX enum for the FlashLoanArbitrage contract
const DEX_ENUM = {
  Uniswap: 0,
  Sushiswap: 1,
  Curve: 2
};

// Fee tiers for Uniswap V3
const UniswapV3FeeTiers = [500, 3000, 10000]; // 0.05%, 0.3%, 1%

async function main() {
  console.log("\n🔍 STARTING ARBITRAGE OPPORTUNITY FINDER\n");
  
  // Ensure we're on a forked network
  const networkName = hre.network.name;
  if (!networkName.includes("hardhat")) {
    console.error("❌ This script must be run on a hardhat forked network");
    process.exit(1);
  }
  
  // Get signers
  const [signer] = await ethers.getSigners();
  console.log(`Using signer: ${signer.address}`);
  
  // Initialize DEX contracts
  console.log("\n🔄 Initializing DEX contracts...");
  const uniswapQuoter = new ethers.Contract(DEX.UniswapV3Quoter, UniswapV3QuoterABI, signer);
  const sushiswapRouter = new ethers.Contract(DEX.SushiswapRouter, SushiswapRouterABI, signer);
  
  // Initialize token info
  console.log("\n💰 Loading token information...");
  const tokenInfo = {};
  
  for (const [symbol, address] of Object.entries(TOKENS)) {
    const token = new ethers.Contract(address, ERC20ABI, signer);
    const decimals = await token.decimals();
    tokenInfo[symbol] = { address, decimals };
    console.log(`- ${symbol}: ${address} (${decimals} decimals)`);
  }
  
  // Check all possible token pairs
  console.log("\n📊 Checking for arbitrage opportunities...");
  
  // Define token pairs to check
  const tokenPairs = [
    { tokenA: "WETH", tokenB: "DAI" },
    { tokenA: "WETH", tokenB: "USDC" },
    { tokenA: "WETH", tokenB: "USDT" },
    { tokenA: "WETH", tokenB: "WBTC" },
    { tokenA: "DAI", tokenB: "USDC" },
    { tokenA: "DAI", tokenB: "USDT" },
    { tokenA: "USDC", tokenB: "USDT" }
  ];
  
  // Test amounts (start with moderate sizes)
  const testAmounts = [
    { token: "WETH", amounts: ["1", "5", "10"] },
    { token: "DAI", amounts: ["1000", "5000", "10000"] },
    { token: "USDC", amounts: ["1000", "5000", "10000"] },
    { token: "USDT", amounts: ["1000", "5000", "10000"] },
    { token: "WBTC", amounts: ["0.1", "0.5", "1"] }
  ];
  
  // Find opportunities
  const opportunities = [];
  
  for (const pair of tokenPairs) {
    const tokenA = pair.tokenA;
    const tokenB = pair.tokenB;
    
    console.log(`\nChecking ${tokenA}/${tokenB} pair...`);
    
    // Get test amounts for this token
    const testAmountsForToken = testAmounts.find(t => t.token === tokenA);
    if (!testAmountsForToken) continue;
    
    for (const amountStr of testAmountsForToken.amounts) {
      const amount = ethers.parseUnits(amountStr, tokenInfo[tokenA].decimals);
      
      console.log(`\nTesting with ${amountStr} ${tokenA}...`);
      
      try {
        // Get best rates from Uniswap V3 (across all fee tiers)
        let bestUniswapRate = 0n;
        let bestFeeTier = 0;
        
        for (const feeTier of UniswapV3FeeTiers) {
          try {
            // Use callStatic to avoid actually executing the transaction
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
            // Skip this fee tier if there's an error (might be no liquidity)
            console.log(`  Warning: Error with Uniswap ${feeTier/10000}% fee tier - likely no liquidity`);
          }
        }
        
        if (bestUniswapRate === 0n) {
          console.log(`  No Uniswap V3 liquidity found for ${tokenA}/${tokenB}`);
          continue;
        }
        
        // Get rate from Sushiswap
        let sushiswapOutput;
        try {
          const path = [tokenInfo[tokenA].address, tokenInfo[tokenB].address];
          const amounts = await sushiswapRouter.getAmountsOut(amount, path);
          sushiswapOutput = amounts[1];
        } catch (error) {
          console.log(`  Warning: Error with Sushiswap - likely no liquidity`);
          continue;
        }
        
        // Format outputs for display
        const uniswapOutputFormatted = ethers.formatUnits(bestUniswapRate, tokenInfo[tokenB].decimals);
        const sushiswapOutputFormatted = ethers.formatUnits(sushiswapOutput, tokenInfo[tokenB].decimals);
        
        console.log(`  Uniswap V3 (${bestFeeTier/10000}% fee): ${uniswapOutputFormatted} ${tokenB}`);
        console.log(`  Sushiswap: ${sushiswapOutputFormatted} ${tokenB}`);
        
        // Check if there's an arbitrage opportunity
        // First direction: Buy on Uniswap, sell on Sushiswap
        if (sushiswapOutput > bestUniswapRate) {
          // This means you can buy cheaper on Uniswap and sell higher on Sushiswap
          const spreadAmount = sushiswapOutput - bestUniswapRate;
          const spreadPercentage = parseFloat(ethers.formatUnits(spreadAmount * 10000n / bestUniswapRate, 2));
          
          // This would be more complicated in a real-world situation due to gas costs and slippage
          console.log(`  🔥 OPPORTUNITY: Buy on Uniswap, sell on Sushiswap`);
          console.log(`  Spread: ${ethers.formatUnits(spreadAmount, tokenInfo[tokenB].decimals)} ${tokenB} (${spreadPercentage}%)`);
          
          // Add to opportunities list
          opportunities.push({
            tokenA,
            tokenB,
            direction: "Uniswap → Sushiswap",
            amountIn: amountStr,
            tokenADecimals: tokenInfo[tokenA].decimals,
            spreadPercentage,
            uniswapRate: uniswapOutputFormatted,
            sushiswapRate: sushiswapOutputFormatted,
            buyDex: DEX_ENUM.Uniswap,
            sellDex: DEX_ENUM.Sushiswap,
            feeTier: bestFeeTier
          });
        }
        
        // Second direction: Buy on Sushiswap, sell on Uniswap
        if (bestUniswapRate > sushiswapOutput) {
          // This means you can buy cheaper on Sushiswap and sell higher on Uniswap
          const spreadAmount = bestUniswapRate - sushiswapOutput;
          const spreadPercentage = parseFloat(ethers.formatUnits(spreadAmount * 10000n / sushiswapOutput, 2));
          
          console.log(`  🔥 OPPORTUNITY: Buy on Sushiswap, sell on Uniswap`);
          console.log(`  Spread: ${ethers.formatUnits(spreadAmount, tokenInfo[tokenB].decimals)} ${tokenB} (${spreadPercentage}%)`);
          
          // Add to opportunities list
          opportunities.push({
            tokenA,
            tokenB,
            direction: "Sushiswap → Uniswap",
            amountIn: amountStr,
            tokenADecimals: tokenInfo[tokenA].decimals,
            spreadPercentage,
            uniswapRate: uniswapOutputFormatted,
            sushiswapRate: sushiswapOutputFormatted,
            buyDex: DEX_ENUM.Sushiswap,
            sellDex: DEX_ENUM.Uniswap,
            feeTier: bestFeeTier
          });
        }
      } catch (error) {
        console.error(`  Error checking ${tokenA}/${tokenB} with ${amountStr} ${tokenA}:`, error.message);
      }
    }
  }
  
  // Report findings
  console.log("\n📋 ARBITRAGE OPPORTUNITIES SUMMARY");
  
  if (opportunities.length === 0) {
    console.log("No arbitrage opportunities found");
  } else {
    // Sort by spread percentage
    opportunities.sort((a, b) => b.spreadPercentage - a.spreadPercentage);
    
    console.log(`Found ${opportunities.length} potential opportunities:`);
    for (let i = 0; i < opportunities.length; i++) {
      const opp = opportunities[i];
      console.log(`\n${i+1}. ${opp.tokenA}/${opp.tokenB} - ${opp.direction}`);
      console.log(`   Amount: ${opp.amountIn} ${opp.tokenA}`);
      console.log(`   Spread: ${opp.spreadPercentage}%`);
      console.log(`   Uniswap rate: ${opp.uniswapRate} ${opp.tokenB}`);
      console.log(`   Sushiswap rate: ${opp.sushiswapRate} ${opp.tokenB}`);
      
      // Generate command for executing this opportunity
      console.log(`\n   To execute this opportunity, run:`);
      const buyDexName = opp.buyDex === DEX_ENUM.Uniswap ? "Uniswap" : "Sushiswap";
      const sellDexName = opp.sellDex === DEX_ENUM.Uniswap ? "Uniswap" : "Sushiswap";
      
      console.log(`   npx hardhat test:flash-loan --token-a ${tokenInfo[opp.tokenA].address} --token-b ${tokenInfo[opp.tokenB].address} --amount ${opp.amountIn} --buy-dex ${opp.buyDex} --sell-dex ${opp.sellDex}`);
    }
    
    if (opportunities.length > 0) {
      // Recommend the best opportunity
      const best = opportunities[0];
      console.log(`\n🏆 BEST OPPORTUNITY: ${best.tokenA}/${best.tokenB} - ${best.direction}`);
      console.log(`   Amount: ${best.amountIn} ${best.tokenA}`);
      console.log(`   Spread: ${best.spreadPercentage}%`);
      
      // Generate flash loan execution parameters
      console.log(`\n🚀 FLASH LOAN EXECUTION PARAMS:`);
      console.log(`   Token A: ${tokenInfo[best.tokenA].address}`);
      console.log(`   Token B: ${tokenInfo[best.tokenB].address}`);
      console.log(`   Amount: ${ethers.parseUnits(best.amountIn, best.tokenADecimals)}`);
      console.log(`   Buy DEX: ${best.buyDex}`);
      console.log(`   Sell DEX: ${best.sellDex}`);
      if (best.buyDex === DEX_ENUM.Uniswap) {
        console.log(`   Uniswap Fee Tier: ${best.feeTier}`);
      }
    }
  }
  
  console.log("\n🏁 ARBITRAGE OPPORTUNITY FINDER COMPLETE\n");
}

// Execute the script
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
