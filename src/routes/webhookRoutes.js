const express = require('express');
const router = express.Router();
const { downloadAudio, transcribeAudio, cleanupAudioFile } = require('../services/audioProcessor');
const { sendWhatsAppMessage } = require('../services/whatsappService');
const { sendMainMenu, sendOtherServicesMenu, sendAboutUs } = require('../services/menuService');
const logger = require('../utils/logger');
const fetch = require('node-fetch');
const userService = require('../services/userService');
const config = require('../config/config');
const {  processDocument } = require('../services/documentProcessor');
const path = require('path');
const { randomUUID } = require('crypto');
const Queue = require('bull');

const BOT_NUMBER = '972544327286';



async function handleUserResponse(message) {
  const sender = message.from;
  const messageBody = message.text.body.trim().toLowerCase();

  try {
    switch (messageBody) {
      case '1':
        await sendWhatsAppMessage(sender, '🎙️ אנא שלחו הודעת אודיו בהעברה ');
        return true;
      case '2':
        await sendWhatsAppMessage(sender, '📄 אנא שלחו מסמך טקסט (.txt), מסמך (.pdf, .docx) או מצגת (.pptx) לעיבוד');
        return true;
      case '3':
        await sendOtherServicesMenu(sender);
        return true;
      case '4':
        await sendAboutUs(sender);
        return true;
      case 'menu':
      case 'start':
      case 'מעע':
        await sendMainMenu(sender);
        return true;
      default:
        return false;
    }
  } catch (error) {
    logger.error('Error in handleUserResponse:', error);
    await sendWhatsAppMessage(sender, "מצטערים, אירעה שגיאה. אנא נסו שוב מאוחר יותר.");
    return true;
  }
}
async function checkTimeUsage(phoneNumber) {
  try {
    const response = await fetch(`http://localhost:${config.port}/api/payments/time-usage/${phoneNumber}`);
    if (!response.ok) {
      throw new Error('Failed to fetch time usage');
    }
    return await response.json();
  } catch (error) {
    logger.error('Error checking time usage:', error);
    return null;
  }
}


async function sendNoCreditsMessage(phoneNumber) {
  await sendWhatsAppMessage(phoneNumber, "אין לך מספיק קרדיטים. אנא רכוש קרדיטים נוספים כדי להמשיך להשתמש בשירות.");
}

async function sendExpiredSubscriptionMessage(phoneNumber) {
  await sendWhatsAppMessage(phoneNumber, "המנוי שלך פג תוקף. אנא חדש את המנוי כדי להמשיך להשתמש בשירות.");
}

async function sendUsageLimitMessage(phoneNumber) {
  await sendWhatsAppMessage(phoneNumber, "הגעת למגבלת השימוש היומית. נסה שוב מאוחר יותר.");
}

async function sendRegistrationInstructions(phoneNumber) {
  await sendWhatsAppMessage(phoneNumber, "ברוך הבא! כדי להשתמש בשירות, אנא הירשם באתר שלנו: www.betzim.com");
}

const documentQueue = new Queue('document processing');

documentQueue.process(async (job) => {
  const { documentObject } = job.data;
  return await processDocument(documentObject);
});

router.post('/', async (req, res) => {
  logger.log('Received webhook payload:', JSON.stringify(req.body, null, 2));
  let responseSent = false;
  let payload;
  const errorId = randomUUID();
  logger.log('Received webhook payload', { errorId, payloadSize: JSON.stringify(req.body).length });
  try {
    payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (error) {
    logger.error('Error parsing webhook payload:', error);
    logger.warn('Error parsing webhook payload, using raw body:', error);
    payload = req.body;
  }
  
  logger.log('Parsed webhook payload:', JSON.stringify(payload, null, 2));
  logger.log('Raw request:', JSON.stringify({
    headers: req.headers,
    body: req.body,
    rawBody: req.rawBody, // This might not exist depending on your setup
    query: req.query,
    params: req.params
  }, null, 2));
 
  try {
    logger.log('Received webhook payload:', JSON.stringify(req.body, null, 2));
    const { messages, event } = req.body;

    if (event && event.type === 'messages' && event.event === 'post' && messages && messages.length > 0) {
      const message = messages[0];
      logger.log('Processing message:', message);

      const phoneNumber = message.from;
      logger.log('Processing message', JSON.stringify({ errorId, phoneNumber, messageType: message.type }));
      // Ignore messages from the bot itself
      if (phoneNumber === BOT_NUMBER) {
        logger.log('Ignoring message from bot number');
       
      }

      const normalizedPhoneNumber = userService.normalizePhoneNumber(phoneNumber);
      logger.log(`Checking user status for normalized phone number: ${normalizedPhoneNumber}`);
      let user = await userService.getUser(normalizedPhoneNumber);

      if (!user) {
        // Register new user
        logger.log(`New user detected. Registering user with phone number: ${normalizedPhoneNumber}`);
        user = await userService.registerUser(normalizedPhoneNumber);
        await sendWhatsAppMessage(phoneNumber, "ברוכים הבאים! נרשמת בהצלחה לתוכנית החינמית. יש לך 10 דקות של תמלול אודיו זמינות.");
        logger.log(`New user registered successfully: ${JSON.stringify(user)}`);
        await sendMainMenu(phoneNumber); // Send the main menu after registration
      }

      if (user) {
        logger.log('User found:', JSON.stringify(user, null, 2));
        logger.log('User found:', user);
        logger.log('Message type:', message.type);

        if (message.type === 'audio') {
          try {
            await sendWhatsAppMessage(phoneNumber, 'קובץ האודיו נשלח לעיבוד, מיד תגיע התוצאה');
            const audioPath = await downloadAudio(message.audio.link);
            const { transcription, duration } = await transcribeAudio(audioPath);
        
            const usageResult = await userService.useAudioTranscription(normalizedPhoneNumber, duration);
        
            await sendWhatsAppMessage(phoneNumber, transcription);
        
            let responseMessage = `התמלול הזה השתמש ב-${duration.toFixed(2)} דקות. נשארו לך ${usageResult.timeLeft.toFixed(2)} דקות.`;
        
            if (usageResult.timeLeft <= 2) {
              responseMessage += '\n\nמומלץ לרכוש דקות נוספות כדי להמשיך ליהנות מהשירות: www.betzim.com';
            }
        
            await sendWhatsAppMessage(phoneNumber, responseMessage);
            
            // Add this line to clean up the audio file
            await cleanupAudioFile(audioPath);
          } catch (error) {
            logger.error('Error processing audio:', error);
            if (error.message === 'Insufficient time') {
              await sendWhatsAppMessage(phoneNumber, 'אין לך מספיק זמן נותר. אנא רכוש דקות נוספות כדי להמשיך להשתמש בשירות: www.betzim.com');
            } else {
              await sendWhatsAppMessage(phoneNumber, 'מצטערים, אירעה שגיאה בעת עיבוד ההודעה שלך. אנא נסה שוב מאוחר יותר.');
            }
          }

        } else if (message.type === 'document') {
          logger.log('Received document message. Full message structure:', JSON.stringify(message, null, 2));

      if (message.document) {
        logger.log('Document details:', JSON.stringify(message.document, null, 2));
        
        if (!message.document.link) {
          logger.error('Document link is missing');
          await sendWhatsAppMessage(phoneNumber, 'מצטערים, לא הצלחנו לקבל את הקישור למסמך. אנא נסה לשלוח שוב.');
        }
        try {
          logger.log('Processing document');
          await sendWhatsAppMessage(phoneNumber, "הקובץ שלך בתור לעיבוד. אנו נשלח לך את התוצאות בקרוב.");
          logger.log('Sent processing message to user');
          const result = await processDocument(message.document);
          logger.log('Document processed:', JSON.stringify(result));
          

          const { summary, processedLength } = result;
          
          logger.log('Sending summary to user');
          await sendWhatsAppMessage(phoneNumber, summary);
          logger.log('Summary sent to user');

          logger.log('Updating user document processing usage');
          const usageResult = await userService.useDocumentProcessing(normalizedPhoneNumber, processedLength);
          logger.log('Usage result:', JSON.stringify(usageResult));
          
          let usageMessage = `העיבוד הזה השתמש ב-${(processedLength / 1000).toFixed(2)} יחידות. נשארו לך ${usageResult.unitsLeft.toFixed(2)} יחידות.`;
          await sendWhatsAppMessage(phoneNumber, usageMessage);
          logger.log('Usage message sent to user');

        } catch (error) {
          logger.error('Error processing document:', {
            error: error.message,
            stack: error.stack,
            phoneNumber: phoneNumber,
            documentId: message.document.id
          });
          
          let errorMessage = 'מצטערים, אירעה שגיאה בעת עיבוד המסמך. אנא נסה שוב מאוחר יותר.';
          if (error.message.includes('File is empty')) {
            errorMessage = 'המסמך שנשלח ריק. אנא נסה לשלוח מסמך אחר.';
          } else if (error.message.includes('File is too large')) {
            errorMessage = 'המסמך גדול מדי. אנא נסה לשלוח מסמך קטן יותר (עד 20MB).';
          } else if (error.message.includes('Incorrect file type')) {
            errorMessage = 'סוג הקובץ אינו נתמך. אנא שלח מסמך מסוג PDF או TXT.';
          } else if (error.message.includes('Invalid OpenAI API key')) {
            errorMessage = 'מצטערים, יש בעיה במערכת. אנא צור קשר עם התמיכה.';
            logger.error('Invalid OpenAI API key');
          } else if (error.message.includes('You exceeded your current quota')) {
            errorMessage = 'מצטערים, חרגנו ממכסת השימוש שלנו. אנא נסה שוב מאוחר יותר.';
            logger.error('OpenAI quota exceeded');
          } else if (error.message.includes('That model is currently overloaded')) {
            errorMessage = 'מצטערים, המערכת עמוסה כרגע. אנא נסה שוב בעוד מספר דקות.';
            logger.error('OpenAI model overloaded');
          } else if (error.message.includes('Extracted text is too short or empty')) {
            errorMessage = 'מצטערים, לא הצלחנו לחלץ טקסט מהמסמך. האם המסמך מכיל טקסט קריא? אנא נסה לשלוח מסמך אחר.';
          }
          
          await sendWhatsAppMessage(phoneNumber, errorMessage);
        }
      }
    }
          
           else if (message.type === 'text') {
            const messageBody = message.text.body.trim().toLowerCase();
            logger.log(`Received text message: "${messageBody}"`);
            if (messageBody === 'סיכום') {
            logger.log(`Received 'סיכום' request from ${normalizedPhoneNumber}`);
            try {
              const user = await userService.getUser(normalizedPhoneNumber);
              if (!user) {
                logger.error(`User not found in webhook for ${normalizedPhoneNumber}`);
                throw new Error('User not found');
              }
              logger.log(`User found in webhook for ${normalizedPhoneNumber}:`, JSON.stringify(user));
              
              const usageResult = await userService.getUserTimeUsage(normalizedPhoneNumber);
              logger.log(`Usage result for ${normalizedPhoneNumber}:`, JSON.stringify(usageResult));
              
              let balanceMessage = `החשבון שלך:\n`;
              balanceMessage += `▪️ תכנית: ${user.payment_plan || 'חינמית'}\n`;
              balanceMessage += `▪️ סך הכל זמן בתכנית: ${usageResult.totalTime.toFixed(2)} דקות\n`;
              balanceMessage += `▪️ זמן שנוצל: ${usageResult.usedTime.toFixed(2)} דקות\n`;
              balanceMessage += `▪️ זמן שנשאר: ${usageResult.timeLeft.toFixed(2)} דקות\n`;
              
              if (user.subscription_end_date) {
                balanceMessage += `▪️ המנוי מסתיים ב: ${new Date(user.subscription_end_date).toLocaleDateString()}\n`;
              }
              
              if (usageResult.timeLeft <= 2) {
                balanceMessage += `\n לא נשארו לך הרבה דקות תמלול. מומלץ להוסיף דקות כדי להמשיך ליהנות: www.betzim.com`;
              }
              
              logger.log(`Sending balance message to ${normalizedPhoneNumber}: ${balanceMessage}`);
              await sendWhatsAppMessage(phoneNumber, balanceMessage);
            } catch (error) {
              logger.error(`Error generating summary for ${normalizedPhoneNumber}:`, error);
              await sendWhatsAppMessage(phoneNumber, "מצטערים, לא הצלחנו לאחזר את פרטי החשבון שלך כרגע. אנא נסה שוב מאוחר יותר.");
            }
          } else {
            logger.log('Calling handleUserResponse');
            const handled = await handleUserResponse(message);
            if (!handled) {
              logger.log('Message not handled, sending main menu', JSON.stringify({ errorId, phoneNumber }));
              const menuIntroSent = await sendWhatsAppMessage(phoneNumber, "הנה התפריט הראשי שלנו:");
              if (!menuIntroSent) {
                logger.error('Failed to send menu intro', JSON.stringify({ errorId, phoneNumber }));
              }
              await sendMainMenu(phoneNumber);
            }}
                
        } else if ( message.type === 'voice'){ 
          async function processAudioMessage(message) {
            const sender = message.from;
            const audioUrl = message.audio ? message.audio.link : message.voice ? message.voice.link : null;
          
            if (!audioUrl) {
              await sendWhatsAppMessage(sender, "מצטערים, לא הצלחנו לקבל את הקובץ הקולי. אנא נסו שוב.");
              return;
            }
          
            try {
              const audioPath = await downloadAudio(audioUrl);
              const { transcription, duration } = await transcribeAudio(audioPath);
          
              const normalizedPhoneNumber = userService.normalizePhoneNumber(sender);
              const usageResult = await userService.useAudioTranscription(normalizedPhoneNumber, duration);
          
              await sendWhatsAppMessage(sender, transcription);
          
              let responseMessage = `התמלול הזה השתמש ב-${duration.toFixed(2)} דקות. נשארו לך ${usageResult.timeLeft.toFixed(2)} דקות.`;
          
              if (usageResult.timeLeft <= 2) {
                responseMessage += '\n\nמומלץ לרכוש דקות נוספות כדי להמשיך ליהנות מהשירות: www.betzim.com';
              }
          
              await sendWhatsAppMessage(sender, responseMessage);
          
              await cleanupAudioFile(audioPath);
            } catch (error) {
              logger.error('Error processing audio:', error);
              if (error.message === 'Insufficient time') {
                await sendWhatsAppMessage(sender, 'אין לך מספיק זמן נותר. אנא רכוש דקות נוספות כדי להמשיך להשתמש בשירות: www.betzim.com');
              } else {
                await sendWhatsAppMessage(sender, 'מצטערים, אירעה שגיאה בעת עיבוד ההודעה הקולית שלך. אנא נסה שוב מאוחר יותר.');
              }
             
          }
          
          
        }  await processAudioMessage(message);
      }
      } else {
          logger.log('Received unsupported message type. Sending main menu.');
          await sendMainMenu(message.from);
        }
             
      
    }
    if (!responseSent) {
      res.sendStatus(200);
      responseSent = true;
    }
  } catch (error) {
    logger.error('Error in webhook route', {
      errorId,
      message: error.message,
      stack: error.stack,
      method: req.method,
      url: req.url,
      headers: {
        'content-type': req.headers['content-type'],
        'user-agent': req.headers['user-agent']
      },
      body: JSON.stringify(req.body)
    });

    if (!responseSent) {
      res.status(500).json({ 
        error: 'Internal server error', 
        errorId 
      });
      responseSent = true;
    }
  } 

  finally {
    // Ensure a response is always sent
    if (!responseSent) {
      res.sendStatus(200);
    }
}});

module.exports = router;