require('dotenv').config();
const { ethers } = require('ethers');
const { ArbitrageBot } = require('./bot/ArbitrageBot');

async function main() {
  console.log('Starting Crypto Arbitrage Bot...');
  
  // Initialize provider and wallet
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  
  const bot = new ArbitrageBot();
  
  await bot.initialize();
  await bot.startScanning();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});