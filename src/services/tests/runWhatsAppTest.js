const { testWhatsAppAPI } = require('./apiTests');
const logger = require('../utils/logger');

async function runTest() {
  try {
    const isConnected = await testWhatsAppAPI();
    if (isConnected) {
      logger.log('WhatsApp API test passed successfully');
    } else {
      logger.error('WhatsApp API test failed');
      process.exit(1);
    }
  } catch (error) {
    logger.error('Error running WhatsApp API test:', error);
    process.exit(1);
  }
}

runTest();