module.exports = {
  apps: [
    {
      name: "arbitrage-telegram-monitor",
      script: "./scripts/telegram-arbitrage-monitor.js",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: "production"
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      out_file: "./logs/telegram-monitor-output.log",
      error_file: "./logs/telegram-monitor-error.log",
      time: true
    }
  ]
};
