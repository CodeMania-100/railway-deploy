const fs = require('fs').promises;
const path = require('path');
const config = require('../config/config');
const logger = require('../utils/logger');

async function cleanupTempFiles() {
  const tempDir = path.resolve(config.tempDir);
  logger.log(`Cleaning up temporary files in ${tempDir}`);

  try {
    const files = await fs.readdir(tempDir);
    const now = Date.now();

    for (const file of files) {
      const filePath = path.join(tempDir, file);
      try {
        const stats = await fs.stat(filePath);
        if (now - stats.mtime.getTime() > config.maxTempFileAge) {
          await fs.unlink(filePath);
          logger.log(`Deleted old temporary file: ${filePath}`);
        }
      } catch (err) {
        logger.error(`Error processing file ${filePath}: ${err}`);
      }
    }
  } catch (err) {
    logger.error(`Error reading temp directory: ${err}`);
  }
}

async function cleanupAudioFile(filePath) {
  try {
    await fs.unlink(filePath);
    logger.log(`Deleted audio file: ${filePath}`);
  } catch (error) {
    logger.error(`Error deleting audio file ${filePath}: ${error}`);
  }
}

module.exports = { cleanupTempFiles, cleanupAudioFile };