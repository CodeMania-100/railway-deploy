const fs = require('fs').promises;
const path = require('path');
const pdfParse = require('pdf-parse');
const { parentPort } = require('worker_threads');

parentPort.on('message', async ({ filePath }) => {
  try {
    const fileExtension = path.extname(filePath).toLowerCase();
    let text;

    if (fileExtension === '.pdf') {
      const dataBuffer = await fs.readFile(filePath);
      const pdfData = await pdfParse(dataBuffer);
      text = pdfData.text;
    } else {
      text = await fs.readFile(filePath, 'utf8');
    }

    parentPort.postMessage(text);
  } catch (error) {
    parentPort.postMessage({ error: error.message });
  }
});