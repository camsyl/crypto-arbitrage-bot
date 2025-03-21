// scripts/fund-contract.js
const { ethers } = require("hardhat");
const { getRpcUrl } = require('../src/utils/rpc-provider');

async function main() {
  // Contract address to fund (use your deployed contract address)
  const contractAddress = "0x15F2ea83eB97ede71d84Bd04fFF29444f6b7cd52"; 
  
  // WETH token address
  const wethAddress = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  
  // Amount to fund (10 WETH)
  const fundAmount = ethers.parseEther("10");
  
  console.log(`Funding contract ${contractAddress} with ${ethers.formatEther(fundAmount)} WETH...`);
  
  // Get WETH contract
  const weth = await ethers.getContractAt("IERC20", wethAddress);
  
  // Get storage slot for balances
  // For WETH, the balances mapping is at slot 3
  const balanceSlot = 3;
  
  // Calculate the specific storage slot for the contract's balance
  // This is keccak256(address + slot)
  const contractBalanceSlot = ethers.keccak256(
    ethers.concat([
      ethers.zeroPadValue(contractAddress.toLowerCase(), 32),
      ethers.zeroPadValue(ethers.toBeHex(balanceSlot), 32)
    ])
  );
  
  console.log(`Setting storage at slot ${contractBalanceSlot}...`);
  
  // Set storage to desired value
  await ethers.provider.send("hardhat_setStorageAt", [
    wethAddress,
    contractBalanceSlot,
    ethers.zeroPadValue(ethers.toBeHex(fundAmount), 32)
  ]);
  
  // Verify the balance was set correctly
  const balance = await weth.balanceOf(contractAddress);
  console.log(`New contract balance: ${ethers.formatEther(balance)} WETH`);
  
  console.log("Contract funded successfully!");
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
