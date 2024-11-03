const axios = require('axios');
const config = require('../config/config');
const logger = require('../utils/logger');

async function sendWhatsAppMessage(to, body, retries = 3) {
  logger.log('Attempting to send WhatsApp message', { to, bodyLength: body.length, retries });

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const payload = {
        to: `${to}@s.whatsapp.net`,
        body: body,
        typing_time: 0,
        no_link_preview: true
      };

      logger.log('Sending WhatsApp message', { to, attempt, payloadSize: JSON.stringify(payload).length });

      const response = await axios.post(`${config.whapiBaseUrl}/messages/text`, payload, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.whapiApiKey}`
        },
        timeout: 15000 // Increased timeout to 15 seconds
      });

      logger.log('WhatsApp message sent successfully', { to, status: response.status, attempt });
      return true;
    } catch (error) {
      logger.error('Error sending WhatsApp message', {
        to,
        attempt,
        error: error.message,
        response: error.response ? {
          status: error.response.status,
          data: error.response.data
        } : null,
        config: error.config ? {
          url: error.config.url,
          method: error.config.method,
          headers: error.config.headers
        } : null
      });

      if (attempt === retries) {
        logger.error('Max retries reached for sending WhatsApp message', { to });
        return false;
      }

      // Exponential backoff with jitter
      const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 1000, 10000);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

module.exports = {
  sendWhatsAppMessage
};