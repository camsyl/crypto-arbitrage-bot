// scripts/arbitrage-test.js
const hre = require("hardhat");
const { ethers } = require("hardhat");
const { getRpcUrl } = require('../src/utils/rpc-provider');

async function main() {
  console.log("Starting arbitrage test on mainnet fork...");

  // Important addresses
  const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const DAI_ADDRESS = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
  const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  
  // Large token holders to impersonate
  const DAI_WHALE = "0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503"; // Binance wallet
  
  // Get signers
  const [deployer] = await ethers.getSigners();
  console.log("Using account:", deployer.address);
  
  // Deploy the FlashLoanArbitrage contract
  console.log("Deploying FlashLoanArbitrage contract...");
  const FlashLoanArbitrage = await ethers.getContractFactory("FlashLoanArbitrage");
  const arbitrage = await FlashLoanArbitrage.deploy();
  await arbitrage.waitForDeployment();
  const arbitrageAddress = await arbitrage.getAddress();
  console.log("FlashLoanArbitrage deployed to:", arbitrageAddress);
  
  // Impersonate the DAI whale
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [DAI_WHALE],
  });
  
  const daiWhale = await ethers.getSigner(DAI_WHALE);
  
  // Get token contracts
  const dai = new ethers.Contract(DAI_ADDRESS, [
    "function balanceOf(address) view returns (uint)",
    "function transfer(address, uint) returns (bool)",
    "function approve(address, uint) returns (bool)"
  ], daiWhale);
  
  // Check DAI balance of whale
  const daiBalance = await dai.balanceOf(DAI_WHALE);
  console.log("DAI Whale balance:", ethers.formatUnits(daiBalance, 18), "DAI");
  
  // Send some ETH to the whale for gas
  await deployer.sendTransaction({
    to: DAI_WHALE,
    value: ethers.parseEther("1.0")
  });
  
  // Send some DAI to the arbitrage contract for testing
  const transferAmount = ethers.parseUnits("10000", 18); // 10,000 DAI
  console.log("Transferring", ethers.formatUnits(transferAmount, 18), "DAI to the arbitrage contract...");
  await dai.transfer(arbitrageAddress, transferAmount);
  
  // Check if the contract received the DAI
  const contractDaiBalance = await dai.balanceOf(arbitrageAddress);
  console.log("Arbitrage contract DAI balance:", ethers.formatUnits(contractDaiBalance, 18), "DAI");
  
  // Setup for a real arbitrage test
  // NOTE: This would require significant setup to create a profitable arbitrage opportunity
  // For this example, we're just testing contract deployment and basic interactions
  
  console.log("Arbitrage test completed on mainnet fork");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
