// scripts/token-info.js
const { ethers } = require("hardhat");
const { getRpcUrl } = require('../src/utils/rpc-provider');

async function main() {
  // Get the network we're connected to
  const network = process.env.HARDHAT_NETWORK || 'mainnet';
  console.log(`Connected to network: ${network}`);
  
  // We'll use hardhat's provider in this script, which is already 
  // configured to use the correct RPC URL via hardhat.config.js
  // Token addresses
  const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const WBTC_ADDRESS = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
  
  // DEX addresses
  const UNISWAP_ROUTER = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
  const UNISWAP_QUOTER = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";
  const SUSHISWAP_ROUTER = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F";
  
  // Get signer
  const [signer] = await ethers.getSigners();
  
  console.log("======= TOKEN INFORMATION =======");
  
  // Get token info
  async function getTokenInfo(address) {
    const tokenContract = await ethers.getContractAt("IERC20", address);
    
    try {
      const name = await tokenContract.name();
      const symbol = await tokenContract.symbol();
      const decimals = await tokenContract.decimals();
      const totalSupply = await tokenContract.totalSupply();
      
      return {
        address,
        name,
        symbol,
        decimals,
        totalSupply: ethers.formatUnits(totalSupply, decimals)
      };
    } catch (error) {
      console.log(`Error getting token info for ${address}: ${error.message}`);
      return { address, error: error.message };
    }
  }
  
  const wethInfo = await getTokenInfo(WETH_ADDRESS);
  const wbtcInfo = await getTokenInfo(WBTC_ADDRESS);
  
  console.log("Token A (WETH):");
  console.log(JSON.stringify(wethInfo, null, 2));
  
  console.log("\nToken B (WBTC):");
  console.log(JSON.stringify(wbtcInfo, null, 2));
  
  // Get current prices and exchange rates
  console.log("\n======= CURRENT EXCHANGE RATES =======");
  
  // Uniswap quoter for price checking
  const uniswapQuoterABI = [
    "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)"
  ];
  
  const uniswapQuoter = new ethers.Contract(UNISWAP_QUOTER, uniswapQuoterABI, signer);
  
  // Sushiswap router for price checking
  const sushiswapRouterABI = [
    "function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)"
  ];
  
  const sushiswapRouter = new ethers.Contract(SUSHISWAP_ROUTER, sushiswapRouterABI, signer);
  
  // Test amounts to check
  const testAmounts = [
    ethers.parseEther("1"),    // 1 WETH
    ethers.parseEther("5"),    // 5 WETH
    ethers.parseEther("10")    // 10 WETH
  ];
  
  console.log("WETH → WBTC Exchange Rates:");
  
  for (const amount of testAmounts) {
    console.log(`\nAmount: ${ethers.formatEther(amount)} WETH`);
    
    try {
      // Get Uniswap quote across different fee tiers
      const feeTiers = [500, 3000, 10000]; // 0.05%, 0.3%, 1%
      let bestUniswapRate = 0n;
      let bestFeeTier = 0;
      
      for (const feeTier of feeTiers) {
        try {
          const output = await uniswapQuoter.quoteExactInputSingle.staticCall(
            WETH_ADDRESS,
            WBTC_ADDRESS,
            feeTier,
            amount,
            0
          );
          
          if (output > bestUniswapRate) {
            bestUniswapRate = output;
            bestFeeTier = feeTier;
          }
        } catch (error) {
          console.log(`  Uniswap ${feeTier/10000}% fee tier: No liquidity`);
        }
      }
      
      if (bestUniswapRate > 0n) {
        console.log(`  Uniswap (${bestFeeTier/10000}% fee): ${ethers.formatUnits(bestUniswapRate, wbtcInfo.decimals)} WBTC`);
        console.log(`  Rate: 1 WETH = ${ethers.formatUnits(bestUniswapRate * ethers.parseEther("1") / amount, wbtcInfo.decimals)} WBTC`);
      } else {
        console.log(`  Uniswap: No liquidity found`);
      }
      
      // Get Sushiswap quote
      try {
        const path = [WETH_ADDRESS, WBTC_ADDRESS];
        const outputs = await sushiswapRouter.getAmountsOut(amount, path);
        const sushiOutput = outputs[1];
        
        console.log(`  Sushiswap: ${ethers.formatUnits(sushiOutput, wbtcInfo.decimals)} WBTC`);
        console.log(`  Rate: 1 WETH = ${ethers.formatUnits(sushiOutput * ethers.parseEther("1") / amount, wbtcInfo.decimals)} WBTC`);
        
        // Calculate price difference
        if (bestUniswapRate > 0n) {
          const diff = Number(sushiOutput) > Number(bestUniswapRate) ? 
            (Number(sushiOutput) - Number(bestUniswapRate)) / Number(bestUniswapRate) * 100 :
            (Number(bestUniswapRate) - Number(sushiOutput)) / Number(sushiOutput) * 100;
          
          console.log(`  Price Difference: ${diff.toFixed(4)}%`);
          
          if (Number(sushiOutput) > Number(bestUniswapRate)) {
            console.log(`  Opportunity: Buy on Uniswap, Sell on Sushiswap`);
          } else if (Number(bestUniswapRate) > Number(sushiOutput)) {
            console.log(`  Opportunity: Buy on Sushiswap, Sell on Uniswap`);
          } else {
            console.log(`  No arbitrage opportunity`);
          }
        }
      } catch (error) {
        console.log(`  Sushiswap: Error - ${error.message}`);
      }
    } catch (error) {
      console.log(`Error checking rates: ${error.message}`);
    }
  }
  
  // Simulate a complete arbitrage trade and calculate potential profit
  console.log("\n======= ARBITRAGE PROFIT SIMULATION =======");
  
  async function simulateArbitrageTrade(amount, buyDex, sellDex) {
    const borrowAmount = amount;
    // Flash loan fee (Aave) is 0.09%
    const flashLoanFee = borrowAmount * 9n / 10000n;
    const totalRepayment = borrowAmount + flashLoanFee;
    
    console.log(`Borrow Amount: ${ethers.formatEther(borrowAmount)} WETH`);
    console.log(`Flash Loan Fee: ${ethers.formatEther(flashLoanFee)} WETH`);
    console.log(`Total Repayment: ${ethers.formatEther(totalRepayment)} WETH`);
    
    // Step 1: Simulate buying WBTC with WETH
    let boughtAmount = 0n;
    
    if (buyDex === "uniswap") {
      // Find best fee tier
      const feeTiers = [500, 3000, 10000];
      let bestUniRate = 0n;
      let bestFeeTier = 0;
      
      for (const feeTier of feeTiers) {
        try {
          const output = await uniswapQuoter.quoteExactInputSingle.staticCall(
            WETH_ADDRESS,
            WBTC_ADDRESS,
            feeTier,
            borrowAmount,
            0
          );
          
          if (output > bestUniRate) {
            bestUniRate = output;
            bestFeeTier = feeTier;
          }
        } catch (error) {
          // Skip fee tier if no liquidity
        }
      }
      
      boughtAmount = bestUniRate;
      console.log(`Buy on Uniswap (${bestFeeTier/10000}% fee):`);
    } else {
      // Sushiswap
      const path = [WETH_ADDRESS, WBTC_ADDRESS];
      const outputs = await sushiswapRouter.getAmountsOut(borrowAmount, path);
      boughtAmount = outputs[1];
      console.log(`Buy on Sushiswap:`);
    }
    
    console.log(`${ethers.formatEther(borrowAmount)} WETH → ${ethers.formatUnits(boughtAmount, wbtcInfo.decimals)} WBTC`);
    
    // Step 2: Simulate selling WBTC back to WETH
    let receivedAmount = 0n;
    
    if (sellDex === "uniswap") {
      // Find best fee tier
      const feeTiers = [500, 3000, 10000];
      let bestUniRate = 0n;
      let bestFeeTier = 0;
      
      for (const feeTier of feeTiers) {
        try {
          const output = await uniswapQuoter.quoteExactInputSingle.staticCall(
            WBTC_ADDRESS,
            WETH_ADDRESS,
            feeTier,
            boughtAmount,
            0
          );
          
          if (output > bestUniRate) {
            bestUniRate = output;
            bestFeeTier = feeTier;
          }
        } catch (error) {
          // Skip fee tier if no liquidity
        }
      }
      
      receivedAmount = bestUniRate;
      console.log(`Sell on Uniswap (${bestFeeTier/10000}% fee):`);
    } else {
      // Sushiswap
      const path = [WBTC_ADDRESS, WETH_ADDRESS];
      const outputs = await sushiswapRouter.getAmountsOut(boughtAmount, path);
      receivedAmount = outputs[1];
      console.log(`Sell on Sushiswap:`);
    }
    
    console.log(`${ethers.formatUnits(boughtAmount, wbtcInfo.decimals)} WBTC → ${ethers.formatEther(receivedAmount)} WETH`);
    
    // Calculate profit
    const profit = receivedAmount > totalRepayment ? receivedAmount - totalRepayment : 0n;
    const profitPercentage = profit > 0n ? Number(profit * 10000n / borrowAmount) / 100 : 0;
    
    console.log(`\nReceivedAmount: ${ethers.formatEther(receivedAmount)} WETH`);
    console.log(`Required Repayment: ${ethers.formatEther(totalRepayment)} WETH`);
    
    if (receivedAmount > totalRepayment) {
      console.log(`✅ Profitable Trade!`);
      console.log(`Profit: ${ethers.formatEther(profit)} WETH (${profitPercentage.toFixed(4)}%)`);
    } else {
      const loss = totalRepayment - receivedAmount;
      const lossPercentage = Number(loss * 10000n / borrowAmount) / 100;
      console.log(`❌ Unprofitable Trade`);
      console.log(`Loss: ${ethers.formatEther(loss)} WETH (${lossPercentage.toFixed(4)}%)`);
    }
    
    // Gas cost estimation
    const gasUnits = 500000; // Estimated gas units for flash loan + 2 swaps
    const gasPrice = await ethers.provider.getFeeData();
    const gasCostWei = gasPrice.gasPrice * BigInt(gasUnits);
    console.log(`Estimated Gas Cost: ${ethers.formatEther(gasCostWei)} ETH`);
    
    // Net profit after gas
    const netProfit = profit > gasCostWei ? profit - gasCostWei : 0n;
    if (netProfit > 0n) {
      const netProfitPercentage = Number(netProfit * 10000n / borrowAmount) / 100;
      console.log(`Net Profit after Gas: ${ethers.formatEther(netProfit)} WETH (${netProfitPercentage.toFixed(4)}%)`);
    } else if (profit > 0n) {
      console.log(`❌ Trade would be unprofitable after gas costs`);
    }
    
    return {
      borrowAmount,
      flashLoanFee,
      totalRepayment,
      boughtAmount,
      receivedAmount,
      profit,
      profitPercentage,
      gasCost: gasCostWei,
      netProfit
    };
  }
  
  console.log("\nSimulating WETH → WBTC → WETH trade (5 WETH, Buy on Sushiswap, Sell on Uniswap):");
  await simulateArbitrageTrade(ethers.parseEther("5"), "sushiswap", "uniswap");
  
  console.log("\nSimulating WETH → WBTC → WETH trade (5 WETH, Buy on Uniswap, Sell on Sushiswap):");
  await simulateArbitrageTrade(ethers.parseEther("5"), "uniswap", "sushiswap");
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
