// scripts/complete-flash-loan-test.js
const { ethers } = require("hardhat");
const { getRpcUrl } = require('../src/utils/rpc-provider');

async function main() {
  // Get signer
  const [deployer] = await ethers.getSigners();
  console.log(`Using account: ${deployer.address}`);
  
  // WETH token address
  const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const WBTC_ADDRESS = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
  
  // Deploy the FlashLoanArbitrage contract
  console.log("Deploying FlashLoanArbitrage contract...");
  const FlashLoanArbitrage = await ethers.getContractFactory("FlashLoanArbitrage");
  const arbitrageContract = await FlashLoanArbitrage.deploy();
  await arbitrageContract.waitForDeployment();
  
  const contractAddress = await arbitrageContract.getAddress();
  console.log(`Contract deployed at: ${contractAddress}`);
  
  // Fund with ETH for gas
  await deployer.sendTransaction({
    to: contractAddress,
    value: ethers.parseEther("1.0")
  });
  console.log(`Funded contract with 1 ETH for gas`);
  
  // Get WETH contract
  const weth = await ethers.getContractAt("IERC20", WETH_ADDRESS);
  
  // Fund contract with WETH by manipulating storage
  const fundAmount = ethers.parseEther("10");
  const balanceSlot = 3; // WETH balance mapping is at slot 3
  
  // Calculate storage slot
  const contractBalanceSlot = ethers.keccak256(
    ethers.concat([
      ethers.zeroPadValue(contractAddress.toLowerCase(), 32),
      ethers.zeroPadValue(ethers.toBeHex(balanceSlot), 32)
    ])
  );
  
  console.log(`Funding contract with ${ethers.formatEther(fundAmount)} WETH...`);
  
  // Set storage to desired value
  await ethers.provider.send("hardhat_setStorageAt", [
    WETH_ADDRESS,
    contractBalanceSlot,
    ethers.zeroPadValue(ethers.toBeHex(fundAmount), 32)
  ]);
  
  // Verify the balance was set correctly
  const initialBalance = await weth.balanceOf(contractAddress);
  console.log(`Contract WETH balance: ${ethers.formatEther(initialBalance)} WETH`);
  
  if (initialBalance < ethers.parseEther("5")) {
    console.error("Not enough WETH for flash loan test!");
    return;
  }
  
  // Set up event listeners
  console.log("Setting up event listeners...");
  
  arbitrageContract.on("ArbitrageExecuted", 
    (tokenA, tokenB, amountBorrowed, profit, timestamp) => {
      console.log(`\n🎉 ARBITRAGE EXECUTED!`);
      console.log(`Token A: ${tokenA}`);
      console.log(`Token B: ${tokenB}`);
      console.log(`Amount Borrowed: ${ethers.formatEther(amountBorrowed)} WETH`);
      console.log(`Profit: ${ethers.formatEther(profit)} WETH`);
      console.log(`Timestamp: ${timestamp}`);
    }
  );
  
  arbitrageContract.on("ArbitrageFailed", 
    (tokenA, tokenB, reason, timestamp) => {
      console.log(`\n❌ ARBITRAGE FAILED!`);
      console.log(`Token A: ${tokenA}`);
      console.log(`Token B: ${tokenB}`);
      console.log(`Reason: ${reason}`);
      console.log(`Timestamp: ${timestamp}`);
    }
  );
  
  // Execute flash loan arbitrage
  console.log("Executing flash loan arbitrage...");
  
  const borrowAmount = ethers.parseEther("5");
  const buyDex = 1; // Sushiswap
  const sellDex = 0; // Uniswap
  
  try {
    const tx = await arbitrageContract.executeArbitrage(
      WETH_ADDRESS,
      WBTC_ADDRESS,
      borrowAmount,
      buyDex,
      sellDex,
      ethers.ZeroAddress, // curvePoolForBuy
      ethers.ZeroAddress, // curvePoolForSell
      {
        gasLimit: 5000000
      }
    );
    
    console.log(`Transaction submitted: ${tx.hash}`);
    console.log(`Waiting for confirmation...`);
    
    const receipt = await tx.wait();
    console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
    console.log(`Gas used: ${receipt.gasUsed.toString()}`);
    
    // Check if any of our events were emitted
    let foundEvents = false;
    for (const log of receipt.logs) {
      try {
        const parsedLog = arbitrageContract.interface.parseLog({
          topics: log.topics,
          data: log.data
        });
        
        if (parsedLog && parsedLog.name) {
          console.log(`Event emitted: ${parsedLog.name}`);
          console.log(`Arguments:`, parsedLog.args);
          foundEvents = true;
        }
      } catch (e) {
        // Not an event we can parse
      }
    }
    
    if (!foundEvents) {
      console.log("No relevant events found in transaction logs");
    }
    
    // Check final balance
    const finalBalance = await weth.balanceOf(contractAddress);
    console.log(`Final WETH balance: ${ethers.formatEther(finalBalance)}`);
    
    // Calculate profit/loss
    const profit = finalBalance - initialBalance;
    console.log(`Profit/Loss: ${ethers.formatEther(profit)} WETH`);
    
  } catch (error) {
    console.error("Error executing flash loan:", error.message);
    
    if (error.data) {
      try {
        const decodedError = arbitrageContract.interface.parseError(error.data);
        console.log(`Decoded error: ${decodedError.name}`);
        if (decodedError.args) {
          console.log(`Error args:`, decodedError.args);
        }
      } catch (e) {
        console.log("Could not decode error data");
      }
    }
  }
  
  // Wait for events to process
  console.log("Waiting for events to process...");
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  console.log("Flash loan test complete!");
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
