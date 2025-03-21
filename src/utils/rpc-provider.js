// utils/rpc-provider.js
require('dotenv').config();

/**
 * Get the appropriate RPC URL based on network and provider selection
 * @param {string} network - 'mainnet' or 'sepolia'
 * @returns {string} RPC URL
 */
function getRpcUrl(network = 'mainnet') {
  const provider = process.env.RPC_PROVIDER || 'public';
  
  switch (provider.toLowerCase()) {
    case 'infura':
      const infuraKey = process.env.INFURA_KEY;
      return network === 'mainnet' 
        ? `https://mainnet.infura.io/v3/${infuraKey}`
        : `https://sepolia.infura.io/v3/${infuraKey}`;
        
    case 'alchemy':
      const alchemyKey = process.env.ALCHEMY_KEY;
      return network === 'mainnet'
        ? `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`
        : `https://eth-sepolia.g.alchemy.com/v2/${alchemyKey}`;
        
    case 'google':
      const googleKey = process.env.GOOGLE_RPC_KEY;
      const projectId = process.env.GOOGLE_PROJECT_ID;
      return network === 'mainnet'
        ? `https://blockchain.googleapis.com/v1/projects/${projectId}/locations/us-central1/endpoints/ethereum-mainnet/rpc?key=${googleKey}`
        : `https://blockchain.googleapis.com/v1/projects/${projectId}/locations/us-central1/endpoints/ethereum-sepolia/rpc?key=${googleKey}`;
        
    case 'public':
    default:
      return network === 'mainnet'
        ? 'https://ethereum-rpc.publicnode.com'
        : 'https://ethereum-sepolia-rpc.publicnode.com';
  }
}

module.exports = { getRpcUrl };