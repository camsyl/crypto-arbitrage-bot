// src/risk/CircuitBreakerManager.js - fix for the netProfit.abs() issue
const config = require('config');
const { ethers } = require('ethers');
const MonitoringService = require('../monitoring/MonitoringService');

class CircuitBreakerManager {
  constructor() {
    // Load configuration
    this.enabled = config.get('circuitBreakers.enabled');
    
    if (!this.enabled) {
      console.log('Circuit breakers are disabled');
      return;
    }
    
    this.maxConsecutiveFailures = config.get('circuitBreakers.maxConsecutiveFailures');
    this.maxDailyLoss = ethers.parseEther(config.get('circuitBreakers.maxDailyLoss'));
    this.cooldownPeriodMinutes = config.get('circuitBreakers.cooldownPeriodMinutes');
    this.priceDeviationPercent = config.get('circuitBreakers.priceDeviationPercent');
    this.liquidityThresholdPercent = config.get('circuitBreakers.liquidityThresholdPercent');
    
    // Initialize state
    this.state = {
      active: false,
      consecutiveFailures: 0,
      dailyLoss: BigInt(0),
      lastResetTime: Date.now(),
      cooldownUntil: 0,
      executionHistory: [],
      breaches: []
    };
    
    console.log('Circuit breaker manager initialized');
    
    // Set up daily reset
    this.setupDailyReset();
  }
  
  setupDailyReset() {
    // Reset daily stats at midnight
    const resetDailyStats = () => {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      const timeToMidnight = midnight.getTime() - now.getTime();
      
      setTimeout(() => {
        this.resetDailyStats();
        // Set up next day's reset
        resetDailyStats();
      }, timeToMidnight);
    };
    
    // Initial setup
    resetDailyStats();
  }
  
  resetDailyStats() {
    console.log('Resetting daily circuit breaker statistics');
    this.state.lastResetTime = Date.now();
    this.state.dailyLoss = BigInt(0);
    this.state.executionHistory = [];
    
    // Save breaches for historical reference
    this.state.breaches = this.state.breaches.slice(-10); // Keep only last 10 breaches
  }
  
  isTripped() {
    // Check if circuit breaker is active
    if (!this.enabled) {
      return false;
    }
    
    // Check if in cooldown period
    if (this.state.active && Date.now() < this.state.cooldownUntil) {
      return true;
    } else if (this.state.active) {
      // Cooldown period has expired, reset active state
      this.state.active = false;
      MonitoringService.logCircuitBreaker('Cooldown period expired, resetting circuit breaker', {
        cooldownExpired: true,
        previousBreaches: this.state.breaches
      });
    }
    
    return false;
  }
  
  // Record a successful arbitrage execution
  recordExecution(profit, gasUsed, tokens) {
    if (!this.enabled) return;
    
    // Calculate net profit/loss
    const netProfit = profit - gasUsed;
    
    // Record execution
    this.state.executionHistory.push({
      timestamp: Date.now(),
      profit,
      gasUsed,
      netProfit,
      tokens
    });
    
    // Reset consecutive failures on success
    if (netProfit > BigInt(0)) {
      this.state.consecutiveFailures = 0;
    } else {
      // Update daily loss for negative net profit
      // For BigInt we need to handle the absolute value manually
      const absoluteLoss = netProfit < BigInt(0) ? -netProfit : netProfit;
      this.state.dailyLoss = this.state.dailyLoss + absoluteLoss;
      
      // Increment consecutive failures
      this.state.consecutiveFailures++;
      
      // Check if max consecutive failures reached
      if (this.state.consecutiveFailures >= this.maxConsecutiveFailures) {
        this.tripCircuitBreaker('Max consecutive failures reached', {
          consecutiveFailures: this.state.consecutiveFailures,
          threshold: this.maxConsecutiveFailures,
          recentExecutions: this.state.executionHistory.slice(-this.maxConsecutiveFailures)
        });
      }
    }
    
    // Check if daily loss threshold exceeded
    if (this.state.dailyLoss > this.maxDailyLoss) {
      this.tripCircuitBreaker('Daily loss threshold exceeded', {
        dailyLoss: ethers.formatEther(this.state.dailyLoss),
        threshold: ethers.formatEther(this.maxDailyLoss),
        executionCount: this.state.executionHistory.length
      });
    }
  }
  
  // Check market conditions before executing arbitrage
  checkMarketConditions(priceData, liquidityData) {
    if (!this.enabled || this.state.active) return true;
    
    // Check price deviation between exchanges
    if (priceData && priceData.deviationPercent > this.priceDeviationPercent) {
      this.tripCircuitBreaker('Excessive price deviation detected', {
        deviationPercent: priceData.deviationPercent,
        threshold: this.priceDeviationPercent,
        token0: priceData.token0,
        token1: priceData.token1,
        exchange0Price: priceData.price0,
        exchange1Price: priceData.price1
      });
      return false;
    }
    
    // Check liquidity availability
    if (liquidityData && liquidityData.availablePercent < this.liquidityThresholdPercent) {
      this.tripCircuitBreaker('Insufficient liquidity detected', {
        availablePercent: liquidityData.availablePercent,
        threshold: this.liquidityThresholdPercent,
        token0: liquidityData.token0,
        token1: liquidityData.token1,
        requiredAmount: liquidityData.requiredAmount,
        availableAmount: liquidityData.availableAmount
      });
      return false;
    }
    
    return true;
  }
  
  // Manually trip circuit breaker
  tripCircuitBreaker(reason, details = {}) {
    if (!this.enabled) return;
    
    console.log(`Circuit breaker tripped: ${reason}`);
    
    this.state.active = true;
    this.state.cooldownUntil = Date.now() + (this.cooldownPeriodMinutes * 60 * 1000);
    
    // Record breach
    const breach = {
      timestamp: Date.now(),
      reason,
      details,
      cooldownUntil: this.state.cooldownUntil
    };
    
    this.state.breaches.push(breach);
    
    // Log circuit breaker activation
    MonitoringService.logCircuitBreaker(reason, {
      ...details,
      active: true,
      cooldownUntil: new Date(this.state.cooldownUntil).toISOString(),
      consecutiveFailures: this.state.consecutiveFailures,
      dailyLoss: ethers.formatEther(this.state.dailyLoss)
    });
    
    return breach;
  }
  
  // Get circuit breaker status
  getStatus() {
    return {
      enabled: this.enabled,
      active: this.state.active,
      consecutiveFailures: this.state.consecutiveFailures,
      dailyLoss: ethers.formatEther(this.state.dailyLoss),
      lastResetTime: new Date(this.state.lastResetTime).toISOString(),
      cooldownUntil: this.state.cooldownUntil > 0 
        ? new Date(this.state.cooldownUntil).toISOString()
        : null,
      executionCount: this.state.executionHistory.length,
      recentBreaches: this.state.breaches.slice(-3)
    };
  }
}

// Export singleton instance
module.exports = new CircuitBreakerManager();