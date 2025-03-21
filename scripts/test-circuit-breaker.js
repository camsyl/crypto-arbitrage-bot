// scripts/test-circuit-breaker.js
const CircuitBreakerManager = require('../src/risk/CircuitBreakerManager');
const { ethers } = require('ethers');
const { getRpcUrl } = require('../src/utils/rpc-provider');

async function testCircuitBreaker() {
  console.log('Testing Circuit Breaker functionality...');
  
  // Check initial status
  const initialStatus = CircuitBreakerManager.getStatus();
  console.log('Initial status:', initialStatus);
  
  // Test recording a successful trade
  console.log('\nRecording successful trade (small profit)...');
  CircuitBreakerManager.recordExecution(
    ethers.parseEther('0.01'), // profit
    ethers.parseEther('0.005'), // gas cost
    { token0Symbol: 'WETH', token1Symbol: 'USDC' }
  );
  
  // Check status after successful trade
  console.log('Status after successful trade:', CircuitBreakerManager.getStatus());
  
  // Test recording failed trades
  console.log('\nRecording 3 consecutive failed trades...');
  for (let i = 0; i < 3; i++) {
    CircuitBreakerManager.recordExecution(
      ethers.parseEther('0.0'), // no profit
      ethers.parseEther('0.005'), // gas cost
      { token0Symbol: 'WETH', token1Symbol: 'USDC' }
    );
  }
  
  // Check if circuit breaker was tripped
  console.log('Circuit breaker tripped?', CircuitBreakerManager.isTripped());
  console.log('Status after failed trades:', CircuitBreakerManager.getStatus());
  
  // Test market condition check
  console.log('\nTesting excessive price deviation...');
  const priceDeviation = {
    deviationPercent: 20, // 20% deviation
    token0: 'WETH',
    token1: 'USDC',
    price0: '2500',
    price1: '3000'
  };
  
  CircuitBreakerManager.checkMarketConditions(priceDeviation, null);
  console.log('Circuit breaker tripped after price deviation?', CircuitBreakerManager.isTripped());
  
  console.log('\nCircuit breaker test complete!');
}

testCircuitBreaker().catch(console.error);
