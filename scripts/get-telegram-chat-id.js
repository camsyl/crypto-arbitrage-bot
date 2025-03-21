// scripts/get-telegram-chat-id.js
const axios = require('axios');

// Replace with your token
const botToken = '8163799396:AAHH6cPRrkawBzApufT3LFaLtnH6Ey7duqQ';

async function getChatId() {
  try {
    const response = await axios.get(`https://api.telegram.org/bot${botToken}/getUpdates`);
    
    if (response.data.result.length === 0) {
      console.log('No messages found. Please send a message to your bot and try again.');
      return;
    }
    
    // Extract chat IDs from all updates
    const chatIds = response.data.result.map(update => 
      update.message?.chat?.id || 
      update.edited_message?.chat?.id || 
      update.channel_post?.chat?.id
    ).filter(id => id);
    
    console.log('Found chat IDs:');
    chatIds.forEach(id => console.log(`- ${id}`));
    
    // Instructions
    console.log('\nAdd the appropriate chat ID to your config file:');
    console.log(`"telegram": {
  "enabled": true,
  "botToken": "${botToken}",
  "chatId": "YOUR_SELECTED_CHAT_ID",
  "throttleTime": 60000
}`);
  } catch (error) {
    console.error('Error getting updates:', error.message);
  }
}

getChatId();