const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { OpenAI } = require('openai');
const config = require('../config/config');
const logger = require('../utils/logger');

const openai = new OpenAI({
  apiKey: config.openaiApiKey,
});

const util = require('util');
const unlinkAsync = util.promisify(fs.unlink);

const tempDir = path.join(__dirname, '..',  'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

async function downloadAudio(url) {
  logger.log('Attempting to download audio from:', url);
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const audioPath = path.join(tempDir, `${Date.now()}.ogg`);
    fs.writeFileSync(audioPath, response.data);
    logger.log('Audio downloaded successfully to:', audioPath);
    return audioPath;
  } catch (error) {
    logger.error('Error downloading audio:', error.message);
    throw error;
  }
}
async function transcribeAudio(filePath) {
  logger.log('Attempting to transcribe audio from:', filePath);
  try {
    const stats = fs.statSync(filePath);
    logger.log(`File size: ${stats.size} bytes`);

    if (stats.size < 1000) {
      throw new Error('Audio file is too small, possibly corrupted or empty');
    }

    const fileStream = fs.createReadStream(filePath);
    
    logger.log('Calling OpenAI API for transcription...');
    const response = await openai.audio.transcriptions.create({
      file: fileStream,
      model: "whisper-1",
      response_format: "verbose_json"
    });

    logger.log('Transcription successful:', response.text);

    // Extract duration from OpenAI response
    const durationInSeconds = response.duration;
    const durationInMinutes = durationInSeconds / 60;
    logger.log('Audio duration:', durationInMinutes, 'minutes');

    return {
      transcription: response.text,
      duration: durationInMinutes
    };
  } catch (error) {
    logger.error('Error transcribing audio:', error.message);
    if (error.response) {
      logger.error('OpenAI API error response:', JSON.stringify(error.response.data, null, 2));
    } else {
      logger.error('Unexpected error:', error);
    }
    throw error;
  }
}

async function cleanupAudioFile(audioPath) {
  try {
    await unlinkAsync(audioPath);
    logger.log(`Audio file ${audioPath} deleted successfully`);
  } catch (error) {
    logger.error(`Error deleting audio file ${audioPath}: ${error.message}`);
  }
}


module.exports = {
  downloadAudio,
  transcribeAudio,
  cleanupAudioFile
};