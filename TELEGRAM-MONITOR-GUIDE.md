# Arbitrage Telegram Monitor Guide

This guide explains how to use the real-time arbitrage monitoring system with Telegram notifications.

## Overview

The Telegram arbitrage monitor continuously scans for profitable trading opportunities across different decentralized exchanges (DEXes) and sends real-time notifications to your Telegram when it detects potential arbitrage opportunities.

## Features

- **Real-time monitoring** of price differences between Uniswap V3 and Sushiswap
- **Smart filtering** to only notify about profitable opportunities (considering gas, fees, etc.)
- **USD price estimation** to prioritize opportunities by potential profit
- **Throttled notifications** to prevent spam during high volatility periods
- **24/7 operation** via PM2 process management

## Prerequisites

1. Node.js installed
2. Telegram bot set up (already configured in your project)
3. Proper Ethereum RPC endpoint configured in .env (already set up)

## Configuration

The monitor uses settings from `config/default.json`:

- `arbitrage.minProfitUsd`: Minimum profit threshold in USD (default: 50)
- `arbitrage.scanInterval`: How often to scan in milliseconds (default: 5000)
- `validation.price.minSpreadPercent`: Minimum price difference percentage (default: 0.5%)
- `telegram.throttleTime`: Minimum time between similar alerts in ms (default: 60000)

## How to Run

### Option 1: Manual Run (for testing)

```bash
# Run directly 
npm run start-telegram-monitor

# Or
node scripts/telegram-arbitrage-monitor.js
```

### Option 2: Run as Background Service (for production)

We've set up PM2 for persistent monitoring:

```bash
# Start the monitor as a background service
npm run pm2-start

# View logs
npm run pm2-logs

# Stop the monitor
npm run pm2-stop
```

## Understanding Telegram Notifications

You'll receive different types of notifications:

1. **Startup Notification**: When monitoring starts
2. **Opportunity Alerts**: When profitable arbitrage is found
   - Token pair (e.g., WETH/USDC)
   - Buy/sell exchanges
   - Price difference percentage
   - Estimated profit in USD
   - Current rates on each exchange
3. **Summary Alerts**: If multiple opportunities are found in a short time
4. **Error Notifications**: If issues occur with the monitoring system
5. **Heartbeat Messages**: Regular status updates to confirm the system is still running

## Monitoring Multiple Pairs

The system monitors a wide range of token pairs, including:

- Major tokens: WETH, WBTC, USDC, USDT, DAI
- DeFi tokens: AAVE, UNI, COMP, MKR, SNX
- Stablecoins: FRAX, LUSD, GUSD
- Liquid staking tokens: STETH, RETH
- Other tokens: BAL, SUSHI, CVX, etc.

## Next Steps

If you want to act on opportunities:
1. Review the notification details in Telegram
2. Use the contract deployment scripts to deploy the arbitrage contract
3. Execute the arbitrage via the arbitrage bot

## Troubleshooting

If you don't receive notifications:
1. Verify your Telegram bot token and chat ID in `config/default.json`
2. Check the logs: `npm run pm2-logs`
3. Ensure your Ethereum RPC endpoint is working
4. Verify the monitor is running: `pm2 list`

## Advanced Usage

For developers, you can extend the system by:
1. Adding more DEXes in the monitor code
2. Implementing triangle arbitrage paths
3. Connecting to CEX APIs for cross-exchange opportunities
