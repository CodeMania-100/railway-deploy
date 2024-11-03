const axios = require('axios');
const config = require('../../config/config');  // Updated path
const logger = require('../../utils/logger');  // Updated path

async function testWhatsAppAPI() {
  try {
    const response = await axios.get(`${config.whapiBaseUrl}/status`, {
      headers: {
        'Authorization': `Bearer ${config.whapiApiKey}`
      }
    });
    logger.log('WhatsApp API status:', response.data);
    return true;
  } catch (error) {
    logger.error('Error testing WhatsApp API:', JSON.stringify({
      message: error.message,
      code: error.code,
      response: error.response ? {
        status: error.response.status,
        data: JSON.stringify(error.response.data)
      } : null
    }));
    return false;
  }
}

module.exports = {
  testWhatsAppAPI
};