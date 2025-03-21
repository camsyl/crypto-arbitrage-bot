// src/monitoring/MonitoringService.js
const TelegramMonitor = require('./TelegramMonitor');
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

class MonitoringService {
  constructor() {
    this.monitors = [];
    
    // Initialize Telegram monitoring if configured
    try {
      const config = require('config');
      if (config.has('telegram.enabled') && config.get('telegram.enabled')) {
        this.telegramMonitor = new TelegramMonitor();
        this.monitors.push(this.telegramMonitor);
      }
    } catch (error) {
      console.error(`Failed to initialize Telegram monitor: ${error.message}`);
    }
    
    // Setup file logging
    this.setupFileLogging();
    
    // Track performance metrics
    this.metrics = {
      arbitrageOpportunities: 0,
      executedArbitrages: 0,
      failedArbitrages: 0,
      totalProfitWei: 0n,
      totalGasUsedWei: 0n,
      startTime: Date.now()
    };
    
    // Heartbeat interval
    this.heartbeatInterval = null;
    try {
      const config = require('config');
      if (config.has('monitoring.heartbeatIntervalMinutes')) {
        const intervalMinutes = config.get('monitoring.heartbeatIntervalMinutes');
        this.startHeartbeat(intervalMinutes);
      }
    } catch (error) {
      console.error(`Failed to set up heartbeat: ${error.message}`);
    }
    
    console.log('Monitoring service initialized');
  }
  
  setupFileLogging() {
    try {
      // Ensure logs directory exists
      const logsDir = path.join(process.cwd(), 'logs');
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }
      
      // Create log files for different event types
      const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
      
      this.logFiles = {
        opportunities: path.join(logsDir, `opportunities_${timestamp}.log`),
        executions: path.join(logsDir, `executions_${timestamp}.log`),
        errors: path.join(logsDir, `errors_${timestamp}.log`),
        metrics: path.join(logsDir, `metrics_${timestamp}.log`)
      };
      
      // Initialize log files with headers
      fs.writeFileSync(this.logFiles.opportunities, 'timestamp,token0,token1,profit,exchange0,exchange1\n');
      fs.writeFileSync(this.logFiles.executions, 'timestamp,txHash,token0,token1,profit,gasUsed,status\n');
      fs.writeFileSync(this.logFiles.errors, 'timestamp,error,details\n');
      fs.writeFileSync(this.logFiles.metrics, 'timestamp,opportunities,executions,failures,totalProfit,totalGas,netProfit\n');
      
      console.log(`File logging initialized at ${logsDir}`);
    } catch (error) {
      console.error(`Failed to set up file logging: ${error.message}`);
    }
  }
  
  startHeartbeat(intervalMinutes) {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    const intervalMs = intervalMinutes * 60 * 1000;
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, intervalMs);
    
    console.log(`Heartbeat monitoring started (interval: ${intervalMinutes} minutes)`);
  }
  
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
  
  async sendHeartbeat() {
    const uptime = this.getUptimeString();
    const message = `Bot heartbeat - Uptime: ${uptime}`;
    
    // Log current metrics
    this.logMetrics();
    
    // Calculate net profit (total profit - total gas)
    let netProfitWei = 0n;
    try {
      netProfitWei = this.metrics.totalProfitWei - this.metrics.totalGasUsedWei;
    } catch (error) {
      // Handle case where metrics are strings instead of BigInts
      console.error(`Error calculating net profit: ${error.message}`);
    }
    
    const data = {
      uptime,
      arbitrageOpportunities: this.metrics.arbitrageOpportunities,
      executedArbitrages: this.metrics.executedArbitrages,
      failedArbitrages: this.metrics.failedArbitrages,
      profitETH: this.formatBigIntEther(this.metrics.totalProfitWei),
      gasUsedETH: this.formatBigIntEther(this.metrics.totalGasUsedWei),
      netProfitETH: this.formatBigIntEther(netProfitWei)
    };
    
    // Send to all monitors
    this.info(message, data);
  }
  
  getUptimeString() {
    const uptimeMs = Date.now() - this.metrics.startTime;
    const seconds = Math.floor(uptimeMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    return `${days}d ${hours % 24}h ${minutes % 60}m ${seconds % 60}s`;
  }
  
  formatBigIntEther(wei) {
    try {
      if (typeof wei === 'string') {
        wei = BigInt(wei);
      }
      return ethers.formatEther(wei);
    } catch (error) {
      return '0.0';
    }
  }
  
  logMetrics() {
    try {
      // Calculate net profit
      let netProfitWei = 0n;
      try {
        netProfitWei = this.metrics.totalProfitWei - this.metrics.totalGasUsedWei;
      } catch (error) {
        console.error(`Error calculating net profit: ${error.message}`);
      }
      
      // Append to metrics log file
      const logLine = [
        new Date().toISOString(),
        this.metrics.arbitrageOpportunities,
        this.metrics.executedArbitrages,
        this.metrics.failedArbitrages,
        this.formatBigIntEther(this.metrics.totalProfitWei),
        this.formatBigIntEther(this.metrics.totalGasUsedWei),
        this.formatBigIntEther(netProfitWei)
      ].join(',') + '\n';
      
      fs.appendFileSync(this.logFiles.metrics, logLine);
    } catch (error) {
      console.error(`Failed to log metrics: ${error.message}`);
    }
  }
  
  // Helper to send alert to all monitors
  async sendToAllMonitors(method, ...args) {
    const results = [];
    for (const monitor of this.monitors) {
      if (typeof monitor[method] === 'function') {
        try {
          const result = await monitor[method](...args);
          results.push(result);
        } catch (err) {
          console.error(`Monitor error (${method}): ${err.message}`);
        }
      }
    }
    return results;
  }
  
  // Public API methods
  async info(message, data = null) {
    return this.sendToAllMonitors('info', message, data);
  }
  
  async success(message, data = null) {
    return this.sendToAllMonitors('success', message, data);
  }
  
  async warning(message, data = null) {
    return this.sendToAllMonitors('warning', message, data);
  }
  
  async error(message, data = null) {
    return this.sendToAllMonitors('error', message, data);
  }
  
  async critical(message, data = null) {
    return this.sendToAllMonitors('critical', message, data);
  }
  
  // Log arbitrage opportunity
  logArbitrageOpportunity(tokens, profitAmount, exchange0, exchange1) {
    this.metrics.arbitrageOpportunities++;
    
    try {
      // Log to file
      const logLine = [
        new Date().toISOString(),
        tokens.token0Symbol,
        tokens.token1Symbol,
        this.formatBigIntEther(profitAmount),
        exchange0,
        exchange1
      ].join(',') + '\n';
      
      fs.appendFileSync(this.logFiles.opportunities, logLine);
    } catch (error) {
      console.error(`Failed to log opportunity: ${error.message}`);
    }
    
    // Send to all monitors
    return this.sendToAllMonitors('reportArbitrageOpportunity', tokens, profitAmount, {
      exchange0,
      exchange1
    });
  }
  
  // Log arbitrage execution
  logArbitrageExecution(txHash, tokens, profit, gasUsed, status = 'success') {
    if (status === 'success') {
      this.metrics.executedArbitrages++;
      
      // Update total profit and gas metrics
      try {
        if (typeof profit === 'string') {
          profit = BigInt(profit);
        }
        if (typeof gasUsed === 'string') {
          gasUsed = BigInt(gasUsed);
        }
        
        this.metrics.totalProfitWei += profit;
        this.metrics.totalGasUsedWei += gasUsed;
      } catch (error) {
        console.error(`Error updating metrics: ${error.message}`);
      }
    } else {
      this.metrics.failedArbitrages++;
    }
    
    try {
      // Log to file
      const logLine = [
        new Date().toISOString(),
        txHash,
        tokens.token0Symbol,
        tokens.token1Symbol,
        this.formatBigIntEther(profit),
        this.formatBigIntEther(gasUsed),
        status
      ].join(',') + '\n';
      
      fs.appendFileSync(this.logFiles.executions, logLine);
    } catch (error) {
      console.error(`Failed to log execution: ${error.message}`);
    }
    
    // Send to all monitors
    return this.sendToAllMonitors('reportArbitrageExecution', txHash, tokens, profit, gasUsed);
  }
  
  // Log error
  logError(error, details = {}) {
    try {
      // Log to file
      const logLine = [
        new Date().toISOString(),
        error.toString().replace(/,/g, ';'),
        JSON.stringify(details).replace(/,/g, ';')
      ].join(',') + '\n';
      
      fs.appendFileSync(this.logFiles.errors, logLine);
    } catch (err) {
      console.error(`Failed to log error: ${err.message}`);
    }
    
    // Determine severity
    const isCritical = details.critical === true;
    
    // Send to all monitors
    if (isCritical) {
      return this.critical(error.toString(), details);
    } else {
      return this.error(error.toString(), details);
    }
  }
  
  // Log circuit breaker activation
  logCircuitBreaker(reason, details = {}) {
    // Send to all monitors
    const results = this.sendToAllMonitors('reportCircuitBreaker', reason, details);
    
    // Also log as critical error
    this.logError(new Error(`Circuit breaker: ${reason}`), {
      ...details,
      critical: true
    });
    
    return results;
  }
}

// Create and export a singleton instance
const monitoringService = new MonitoringService();
module.exports = monitoringService;