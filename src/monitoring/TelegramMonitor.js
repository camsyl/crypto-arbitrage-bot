// src/monitoring/TelegramMonitor.js
const TelegramBot = require('node-telegram-bot-api');
const config = require('config');
const { ethers } = require('ethers'); // Import ethers v6 correctly

class TelegramMonitor {
  constructor() {
    try {
      const telegramConfig = config.get('telegram');
      this.token = telegramConfig.botToken;
      this.chatId = telegramConfig.chatId;
      
      if (!this.token || !this.chatId) {
        throw new Error('Missing Telegram configuration');
      }
      
      this.bot = new TelegramBot(this.token, { polling: false });
      this.enabled = true;
      this.alertLevels = {
        INFO: '📊',
        SUCCESS: '✅',
        WARNING: '⚠️',
        ERROR: '🚨',
        CRITICAL: '🔥'
      };
      
      // Alert throttling - avoid spamming
      this.throttleTime = telegramConfig.throttleTime || 60000; // 1 minute default
      this.lastAlertTime = {};
      
      console.log('Telegram monitoring initialized');
    } catch (error) {
      console.error(`Failed to initialize Telegram monitoring: ${error.message}`);
      this.enabled = false;
    }
  }

  async sendAlert(level, message, data = null) {
    if (!this.enabled) {
      console.log(`Telegram disabled. Would have sent ${level}: ${message}`);
      return false;
    }
    
    // Check throttling for this alert level
    const now = Date.now();
    if (this.lastAlertTime[level] && now - this.lastAlertTime[level] < this.throttleTime) {
      console.log(`Throttling ${level} alert: ${message}`);
      return false;
    }
    
    this.lastAlertTime[level] = now;
    
    const emoji = this.alertLevels[level] || '📋';
    let formattedMessage = `${emoji} *${level}*\n${message}`;
    
    // Add data if provided
    if (data) {
      const dataString = typeof data === 'object' 
        ? JSON.stringify(data, this.replacer, 2)
        : data.toString();
      
      formattedMessage += `\n\`\`\`\n${dataString}\n\`\`\``;
    }
    
    try {
      await this.bot.sendMessage(this.chatId, formattedMessage, {
        parse_mode: 'Markdown'
      });
      return true;
    } catch (error) {
      console.error(`Failed to send Telegram alert: ${error.message}`);
      return false;
    }
  }
  
  // Helper to format big numbers in JSON
  replacer(key, value) {
    // Format BigInt values (ethers v6 uses native BigInt, not BigNumber objects)
    if (typeof value === 'bigint') {
      // Try to determine if it's ETH or a token amount
      if (key.toLowerCase().includes('eth') || key.toLowerCase().includes('amount')) {
        return `${ethers.formatEther(value)} ETH`;
      } else if (key.toLowerCase().includes('gas')) {
        return value.toString();
      } else {
        return value.toString();
      }
    }
    return value;
  }
  
  // Convenience methods for different alert types
  async info(message, data = null) {
    return this.sendAlert('INFO', message, data);
  }
  
  async success(message, data = null) {
    return this.sendAlert('SUCCESS', message, data);
  }
  
  async warning(message, data = null) {
    return this.sendAlert('WARNING', message, data);
  }
  
  async error(message, data = null) {
    return this.sendAlert('ERROR', message, data);
  }
  
  async critical(message, data = null) {
    return this.sendAlert('CRITICAL', message, data);
  }
  
  // Special methods for arbitrage events
  async reportArbitrageOpportunity(tokens, profitAmount, exchangeInfo) {
    const message = `Found arbitrage opportunity: ${tokens.token0Symbol}/${tokens.token1Symbol}`;
    const data = {
      token0: tokens.token0Symbol,
      token1: tokens.token1Symbol,
      profitETH: ethers.formatEther(profitAmount),
      exchanges: exchangeInfo,
      timestamp: new Date().toISOString()
    };
    
    return this.info(message, data);
  }
  
  async reportArbitrageExecution(txHash, tokens, profit, gasUsed) {
    const message = `Executed arbitrage: ${tokens.token0Symbol}/${tokens.token1Symbol}`;
    const data = {
      txHash,
      token0: tokens.token0Symbol,
      token1: tokens.token1Symbol,
      profitETH: ethers.formatEther(profit),
      gasUsed: gasUsed.toString(),
      gasUsedETH: ethers.formatEther(gasUsed),
      timestamp: new Date().toISOString()
    };
    
    return this.success(message, data);
  }
  
  async reportCircuitBreaker(reason, details) {
    const message = `Circuit breaker activated: ${reason}`;
    return this.critical(message, details);
  }
}

module.exports = TelegramMonitor;