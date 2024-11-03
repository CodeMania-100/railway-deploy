require('dotenv').config();
const path = require('path');

module.exports = {
  openaiApiKey: process.env.OPENAI_API_KEY,
  whapiApiKey: process.env.WHAPI_API_KEY,
  whapiBaseUrl: 'https://gate.whapi.cloud',
  port: process.env.PORT || 3000,
  tempDir: process.env.TEMP_DIR || './temp', 
  maxTempFileAge: process.env.MAX_TEMP_FILE_AGE || 3600000, // 1 hour in milliseconds
  tempDir: process.env.TEMP_DIR || path.join(__dirname, '..', './temp'),
  maxFileSize: 10 * 1024 * 1024, // 10MB
};
