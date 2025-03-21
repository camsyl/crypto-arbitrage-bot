// scripts/test-integration.js
require('dotenv').config();
const { ethers } = require('ethers');
const MonitoringService = require('../src/monitoring/MonitoringService');
const CircuitBreakerManager = require('../src/risk/CircuitBreakerManager');
const { getRpcUrl } = require('../src/utils/rpc-provider');

async function testIntegration() {
    console.log('Testing full system integration...');

    // Parse command line arguments for network selection
    const args = process.argv.slice(2);
    const network = args.includes('--mainnet') ? 'mainnet' : 'sepolia';
    console.log(`Using network: ${network}`);

    // Get appropriate RPC URL
    const rpcUrl = getRpcUrl(network);
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    console.log(`Network: ${network}`);

    // Set up signer using the private key from .env
    let signer;
    if (process.env.PRIVATE_KEY) {
        signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
        const address = await signer.getAddress();
        const balance = await provider.getBalance(address);
        console.log(`Using wallet from PRIVATE_KEY env var: ${address}`);
        console.log(`Wallet balance: ${ethers.formatEther(balance)} ETH`);
    } else {
        console.log('No private key found in .env file - skipping contract interaction tests');
    }

    // Test monitoring service
    console.log('\nTesting monitoring service...');
    await MonitoringService.info('Integration test', {
        timestamp: new Date().toISOString(),
        network
    });
    console.log('Monitoring alert sent');

    // Test circuit breaker
    console.log('\nTesting circuit breaker integration...');
    CircuitBreakerManager.tripCircuitBreaker('Test circuit breaker activation', {
        testRun: true,
        timestamp: new Date().toISOString()
    });

    console.log('Circuit breaker tripped:', CircuitBreakerManager.isTripped());
    console.log('Circuit breaker status:', CircuitBreakerManager.getStatus());

    // Simulate opportunity detection
    console.log('\nSimulating arbitrage opportunity...');
    MonitoringService.logArbitrageOpportunity(
        { token0Symbol: 'WETH', token1Symbol: 'USDC' },
        ethers.parseEther('0.05'),
        'Uniswap',
        'SushiSwap'
    );

    // Simulate trade execution
    console.log('\nSimulating trade execution...');
    MonitoringService.logArbitrageExecution(
        '0x' + '0'.repeat(64),  // Fake transaction hash
        { token0Symbol: 'WETH', token1Symbol: 'USDC' },
        ethers.parseEther('0.05'),  // Profit
        ethers.parseEther('0.02')   // Gas cost
    );

    // If we have a signer and provider, we can test contract interaction
    if (signer && process.env.FLASH_LOAN_CONTRACT_ADDRESS) {
        console.log('\nTesting contract interaction...');

        // Get the contract instance
        const contractABI = ["function owner() view returns (address)"];
        const contract = new ethers.Contract(
            process.env.FLASH_LOAN_CONTRACT_ADDRESS,
            contractABI,
            signer
        );

        // Try to call a simple view function (owner)
        try {
            const owner = await contract.owner();
            console.log(`Contract owner: ${owner}`);
            console.log('Contract interaction successful');
        } catch (error) {
            console.error(`Contract interaction failed: ${error.message}`);
        }
    }

    console.log('\nIntegration test complete!');
}

testIntegration().catch(console.error);