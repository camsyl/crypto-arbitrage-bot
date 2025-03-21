# Crypto Arbitrage Bot with Telegram Monitoring

A sophisticated system for monitoring and executing cryptocurrency arbitrage opportunities across decentralized exchanges (DEXes) with real-time Telegram notifications.

## Features

- **Flash Loan Arbitrage**: Execute arbitrage using Aave flash loans with zero capital requirements
- **Multi-DEX Support**: Monitor price differences between Uniswap V3, Sushiswap, and other DEXes
- **Real-time Notifications**: Receive instant Telegram alerts when profitable opportunities arise
- **Advanced Validation**: Multiple layers of validation to ensure opportunities are legitimate:
  - Liquidity validation to prevent slippage
  - Price anomaly detection
  - Gas cost accounting
  - Flash loan fee calculations
- **Multi-Path Arbitrage**: Find complex opportunities across multiple tokens
- **Persistent Monitoring**: Run 24/7 as a background service with PM2 or systemd

## Project Structure

```
├── contracts/                   # Smart contracts
│   ├── FlashLoanArbitrage.sol   # Base flash loan arbitrage contract
│   └── FlashLoanArbitrageOptimized.sol  # Gas-optimized arbitrage contract
├── scripts/                     # Scripts for deployment and monitoring
│   ├── deploy-optimized.js      # Deploy optimized contract
│   ├── telegram-arbitrage-monitor.js  # Main monitoring script
│   └── test-telegram.js         # Test Telegram notifications
├── src/                         # Core code
│   ├── bot/                     # Bot logic components
│   ├── monitoring/              # Monitoring services 
│   ├── oracles/                 # Price oracle integration
│   ├── risk/                    # Risk management
│   └── utils/                   # Utility functions
├── ecosystem.config.js          # PM2 configuration
├── TELEGRAM-MONITOR-GUIDE.md    # Guide for using Telegram monitoring
└── README.md                    # This file
```

## Prerequisites

- Node.js (v16+)
- Ethereum RPC provider (Infura, Alchemy, etc.)
- Telegram bot token
- (Optional) PM2 for persistent operation

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/crypto-arbitrage-bot.git
   cd crypto-arbitrage-bot
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   - Copy `.env.example` to `.env`
   - Add your Ethereum RPC provider details
   - Add your private key (if executing transactions)

4. Configure `config/default.json`:
   - Set your Telegram bot token and chat ID
   - Adjust arbitrage thresholds and scan intervals

## Usage

### Testing the Telegram Integration

Test that your Telegram notifications are working:

```bash
npm run test-telegram
```

### Running the Arbitrage Monitor

Start the Telegram arbitrage monitor:

```bash
npm run start-telegram-monitor
```

### Running as a Background Service

Using PM2:

```bash
npm run pm2-start
```

View logs:

```bash
npm run pm2-logs
```

Stop the service:

```bash
npm run pm2-stop
```

## Configuration Options

Edit `config/default.json` to adjust:

- `arbitrage.minProfitUsd`: Minimum profit threshold in USD (default: 50)
- `arbitrage.scanInterval`: How often to scan in milliseconds (default: 5000)
- `validation.price.minSpreadPercent`: Minimum price difference percentage (default: 0.5%)
- `telegram.throttleTime`: Minimum time between similar alerts in ms (default: 60000)

## Security Considerations

- **Private Keys**: Never share your private keys or .env file
- **Smart Contract Audits**: Consider an audit before deploying contracts with significant funds
- **Gradual Deployment**: Start with small amounts to test the system
- **Circuit Breakers**: The system includes circuit breakers to halt operations if anomalies are detected

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [Aave](https://aave.com/) for flash loan functionality
- [Uniswap](https://uniswap.org/) and [Sushiswap](https://sushi.com/) for DEX integration
