// scripts/test-telegram.js
const MonitoringService = require('../src/monitoring/MonitoringService');
const { ethers } = require('ethers');
const { getRpcUrl } = require('../src/utils/rpc-provider');

async function testTelegram() {
  console.log('Testing Telegram monitoring...');
  
  // Test info message
  await MonitoringService.info('Test info message', { timestamp: new Date().toISOString() });
  console.log('Sent info message');
  
  // Test success message with profit
  await MonitoringService.success('Test success message', { profit: '0.01 ETH' });
  console.log('Sent success message');
  
  // Test warning message with BigInt
  const gasBigInt = BigInt('100000000000'); // 100 Gwei in wei
  await MonitoringService.warning('Test warning message with BigInt', { 
    gasPrice: gasBigInt,
    gasInGwei: ethers.formatUnits(gasBigInt, 'gwei')
  });
  console.log('Sent warning message with BigInt');
  
  // Test error message
  await MonitoringService.error('Test error message', { error: 'Something went wrong' });
  console.log('Sent error message');
  
  // Test arbitrage opportunity
  await MonitoringService.logArbitrageOpportunity(
    { token0Symbol: 'WETH', token1Symbol: 'USDC' },
    ethers.parseEther('0.05'),
    'Uniswap',
    'SushiSwap'
  );
  console.log('Sent arbitrage opportunity alert');

  console.log('All test messages sent!');
}

testTelegram().catch(console.error);
