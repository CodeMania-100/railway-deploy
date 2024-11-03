const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { OpenAI } = require('openai');
const config = require('../config/config');
const logger = require('../utils/logger');
const pdfParse = require('pdf-parse');

const openai = new OpenAI({
  apiKey: config.openaiApiKey,
});


async function processDocument(documentObject) {
  logger.log('Starting document processing:', JSON.stringify(documentObject));
  let filePath;
  try {
    const startTime = Date.now();
    filePath = await downloadDocument(documentObject.link, documentObject.mime_type);
    logger.log(`Document downloaded successfully to: ${filePath}. Time taken: ${Date.now() - startTime}ms`);

    const documentText = await extractTextFromDocument(filePath);
    logger.log(`Text extracted from document. Length: ${documentText.length} characters`);

    if (documentText.length < 10) {  // Arbitrary threshold, adjust as needed
      throw new Error('Extracted text is too short or empty');
    }

    const summary = await summarizeText(documentText);
    logger.log(`Document summarized. Total time taken: ${Date.now() - startTime}ms`);

    return {
      summary: summary,
      processedLength: summary.length
    };
  } catch (error) {
    logger.error('Error in processDocument:', error);
    throw error;
  } finally {
    if (filePath) await cleanupDocumentFile(filePath);
  }
}

async function extractTextFromDocument(filePath) {
  const fileExtension = path.extname(filePath).toLowerCase();
  if (fileExtension === '.pdf') {
    const dataBuffer = await fs.readFile(filePath);
    const pdfData = await pdfParse(dataBuffer);
    return pdfData.text;
  } else {
    return fs.readFile(filePath, 'utf8');
  }
}

async function summarizeText(text) {
  const maxChunkSize = 4000; // Adjust based on the model's token limit
  const chunks = splitIntoChunks(text, maxChunkSize);
  let summaries = [];

  for (const chunk of chunks) {
    const summary = await askGPT(chunk);
    summaries.push(summary);
  }

  // If we have multiple summaries, summarize them again
  if (summaries.length > 1) {
    const finalSummary = await askGPT(summaries.join('\n\n'));
    return finalSummary;
  } else {
    return summaries[0];
  }
}

function splitIntoChunks(text, maxChunkSize) {
  const words = text.split(/\s+/);
  const chunks = [];
  let currentChunk = '';

  for (const word of words) {
    if ((currentChunk + word).length > maxChunkSize) {
      chunks.push(currentChunk.trim());
      currentChunk = '';
    }
    currentChunk += word + ' ';
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

async function askGPT(prompt) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a helpful assistant that summarizes documents in Hebrew. Be concise but comprehensive." },
        { role: "user", content: `Please summarize the following text in Hebrew:\n\n${prompt}` }
      ],
      max_tokens: 1500,
      temperature: 0.7,
    });

    return response.choices[0].message.content;
  } catch (error) {
    logger.error('Error in askGPT:', error);
    throw error;
  }
}

async function downloadDocument(link, mimeType) {
  logger.log(`Downloading document from link: ${link}, MIME type: ${mimeType}`);
  try {
    const response = await axios({
      method: 'GET',
      url: link,
      responseType: 'arraybuffer'
    });

    logger.log('Document downloaded. Response status:', response.status);
    const tempDir = path.join(__dirname, '..', 'temp');
    await fs.mkdir(tempDir, { recursive: true });

    const fileExtension = getFileExtension(mimeType);
    const fileName = `document_${Date.now()}.${fileExtension}`;
    const filePath = path.join(tempDir, fileName);

    await fs.writeFile(filePath, response.data);
    logger.log(`Document saved to: ${filePath}`);

    return filePath;
  } catch (error) {
    logger.error('Error downloading document:', {
      message: error.message,
      stack: error.stack,
      details: JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
    });
    throw error;
  }
}

async function createAssistant() {
  return await openai.beta.assistants.create({
    name: "Document Summarizer",
    instructions: "You are a helpful assistant that summarizes documents. Be concise but comprehensive.",
    model: "gpt-4-1106-preview",
  });
}



async function uploadFileToOpenAI(filePath, purpose) {
  logger.log(`Uploading file to OpenAI: ${filePath}`);
  const form = new FormData();
  form.append('file', await fs.readFile(filePath), path.basename(filePath));
  form.append('purpose', purpose);

  try {
    const response = await axios.post('https://api.openai.com/v1/files', form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${config.openaiApiKey}`,
      },
    });

    logger.log('File uploaded successfully:', response.data.id);
    return response.data.id;
  } catch (error) {
    logger.error('Error uploading file to OpenAI:', {
      message: error.message,
      stack: error.stack,
      details: JSON.stringify(error.response?.data || error, null, 2)
    });
    if (error.response && error.response.status === 401) {
      throw new Error('Invalid OpenAI API key');
    }
    throw error;
  }
}

async function processWithOpenAI(fileId) {
  logger.log('Starting processWithOpenAI function with fileId:', fileId);
  try {
    // Check API key validity
    try {
      await openai.models.list();
    } catch (apiKeyError) {
      logger.error('Error validating OpenAI API key:', apiKeyError);
      throw new Error('Invalid OpenAI API key');
    }

    // Retrieve the file content
    logger.log('Retrieving file from OpenAI');
    const file = await openai.files.retrieve(fileId);
    logger.log('File retrieved:', JSON.stringify(file));

    // Create an assistant
    logger.log('Creating assistant');
    let assistant;
    try {
      assistant = await openai.beta.assistants.create({
        name: "Document Summarizer",
        instructions: "You are a helpful assistant that summarizes documents in Hebrew. Be concise but comprehensive.",
        model: "gpt-4o-mini",
        tools: [{"type": "retrieval"}],
        file_ids: [fileId]
      });
      logger.log('Assistant created:', assistant.id);
    } catch (assistantError) {
      logger.error('Error creating assistant:', {
        name: assistantError.name,
        message: assistantError.message,
        stack: assistantError.stack,
        details: JSON.stringify(assistantError, Object.getOwnPropertyNames(assistantError), 2)
      });
      if (assistantError.response) {
        logger.error('OpenAI API response for assistant creation:', JSON.stringify(assistantError.response.data));
      }
      throw assistantError;
    }

    // Create a thread
    logger.log('Creating thread');
    const thread = await openai.beta.threads.create();
    logger.log('Thread created:', thread.id);

    // Add a message to the thread
    logger.log('Adding message to thread');
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: "Please summarize the content of the uploaded document in Hebrew.",
      file_ids: [fileId]
    });

    // Run the assistant
    logger.log('Running assistant');
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistant.id,
    });

    // Wait for the run to complete
    logger.log('Waiting for run to complete');
    let runStatus;
    do {
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      logger.log('Run status:', runStatus.status);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for 1 second before checking again
    } while (runStatus.status !== 'completed' && runStatus.status !== 'failed');

    if (runStatus.status === 'failed') {
      logger.error('Run failed:', runStatus.last_error);
      throw new Error(`Run failed: ${runStatus.last_error?.message || 'Unknown error'}`);
    }

    // Retrieve the messages
    logger.log('Retrieving messages');
    const messages = await openai.beta.threads.messages.list(thread.id);

    // Get the last assistant message
    const assistantMessages = messages.data.filter(m => m.role === 'assistant');
    const lastMessage = assistantMessages[assistantMessages.length - 1];

    if (!lastMessage) {
      logger.error('No assistant message found');
      throw new Error('No assistant message found');
    }

    const summary = lastMessage.content[0].text.value;
    logger.log('Summary generated successfully. Length:', summary.length);
    return summary;
  } catch (error) {
    logger.error('Error in processWithOpenAI:', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      details: JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
    });
    if (error.response) {
      logger.error('OpenAI API response:', JSON.stringify(error.response.data));
    }
    throw error;
  }
}

async function cleanupResources(filePath, fileId) {
  if (filePath) {
    await cleanupDocumentFile(filePath);
  }
  if (fileId) {
    await deleteFileFromOpenAI(fileId);
  }
}

async function deleteFileFromOpenAI(fileId) {
  logger.log(`Deleting file from OpenAI: ${fileId}`);
  try {
    await openai.files.del(fileId);
    logger.log('File deleted successfully from OpenAI');
  } catch (error) {
    logger.error('Error deleting file from OpenAI:', {
      message: error.message,
      stack: error.stack,
      details: JSON.stringify(error.response?.data || error, null, 2)
    });
  }
}

async function cleanupDocumentFile(documentPath) {
  try {
    await fs.unlink(documentPath);
    logger.log(`Document file ${documentPath} deleted successfully`);
  } catch (error) {
    logger.error(`Error deleting document file ${documentPath}:`, {
      message: error.message,
      stack: error.stack,
      details: JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
    });
  }
}

function getFileExtension(mimeType) {
  const mimeTypeMap = {
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'text/plain': 'txt'
  };
  return mimeTypeMap[mimeType] || 'unknown';
}

module.exports = {
  processDocument,
  downloadDocument,
  uploadFileToOpenAI,
  processWithOpenAI,
  deleteFileFromOpenAI,
  cleanupDocumentFile,
  getFileExtension
};