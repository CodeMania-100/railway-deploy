const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { OpenAI } = require('openai');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const WHAPI_API_KEY = process.env.WHAPI_API_KEY;
const WHAPI_BASE_URL = 'https://gate.whapi.cloud';

const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

async function downloadAudio(url) {
  console.log('Attempting to download audio from:', url);
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const audioPath = path.join(tempDir, `${Date.now()}.ogg`);
    fs.writeFileSync(audioPath, response.data);
    console.log('Audio downloaded successfully to:', audioPath);
    return audioPath;
  } catch (error) {
    console.error('Error downloading audio:', error.message);
    throw error;
  }
}

async function transcribeAudio(filePath) {
  console.log('Attempting to transcribe audio from:', filePath);
  try {
    const response = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: "whisper-1",
    });
    console.log('Transcription successful:', response.text);
    return response.text;
  } catch (error) {
    console.error('Error transcribing audio:', error.message);
    throw error;
  }
}

async function sendWhatsAppMessage(to, body) {
  console.log('Attempting to send WhatsApp message to:', to);
  console.log('Message body:', body);
  try {
    const payload = {
      to: `${to}@s.whatsapp.net`,
      body: body,
      typing_time: 0,
      no_link_preview: true
    };

    console.log('Sending WhatsApp message with payload:', JSON.stringify(payload, null, 2));

    const response = await axios.post(`${WHAPI_BASE_URL}/messages/text`, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${WHAPI_API_KEY}`
      }
    });

    console.log('WhatsApp message sent successfully. Response:', response.data);
  } catch (error) {
    console.error('Error sending WhatsApp message:', error.message);
    throw error;
  }
}

// Function to send the main menu
async function sendMainMenu(to) {
  const menuText = `👻 ברוכים הבאים! תבחרו באחת האופציות הבאות:

1️⃣ תמלול הודעות טקסט
2️⃣ עזרה
3️⃣ שירותים נוספים
4️⃣ עלינו
5️⃣ אופרה גייז

אנא בחרו באחת האופציות`;

  await sendWhatsAppMessage(to, menuText);
}

// Function to handle user responses
async function handleUserResponse(message) {
  const sender = message.from;
  const messageBody = message.text.body.trim().toLowerCase();

  switch (messageBody) {
    case '1':
      await sendWhatsAppMessage(sender, '🎙️ אנא שלחו הודעת אודיו בהעברה ');
      break;
    case '2':
      await sendHelpMenu(sender, 'עזרה לא פה היום');
      break;
    case '3':
      await sendOtherServicesMenu(sender);
      break;
    case '4':
      await sendAboutUs(sender);
      break;
    case 'menu':
    case 'start':
    case '':
      await sendMainMenu(sender);
      break;
    default:
      await sendWhatsAppMessage(sender, "סליחה לא הבנתי, הנה התפריט:");
      await sendMainMenu(sender);
      break;
  }
}

// Function to send the help menu
async function sendHelpMenu(to) {
  const helpText = `📚 תפריט עזרה:

1. איך להשתמש בבוט
2. FAQs
3. תמיכה
4. חזרה לתפריט הראשי

אנא בחרו באחת האופציות`;

  await sendWhatsAppMessage(to, helpText);
}

// Function to send the other services menu
async function sendOtherServicesMenu(to) {
  const servicesText = `🛠️ שירותים נוספים:

1. תרגום
2. סיכום טקסט ושיחות
3. צרו תמונות
4. חזרה לתפריט הראשי

אנא בחרו באחת האופציות`;

  await sendWhatsAppMessage(to, servicesText);
}

// Function to send about us information
async function sendAboutUs(to) {
  const aboutText = `עלינו:

תמללו הודעות כדי שלא תצטרכו לבזבז זמן להקשיב להן

לחזרה לתפריט הראשי הקישו את המילה מעעע`;

  await sendWhatsAppMessage(to, aboutText);
}

app.post('/webhook', async (req, res) => {
  console.log('Received webhook payload:', JSON.stringify(req.body, null, 2));
  const { messages, event } = req.body;

  if (event && event.type === 'messages' && event.event === 'post' && messages && messages.length > 0) {
    const message = messages[0];
    console.log('Processing message:', message);

    if (message.type === 'audio') {
      try {
        console.log('Processing audio message');
        const audioPath = await downloadAudio(message.audio.link);
        const transcription = await transcribeAudio(audioPath);
        await sendWhatsAppMessage(message.from, `Transcription: ${transcription}`);
        fs.unlinkSync(audioPath);
        console.log('Audio processing completed successfully');
      } catch (error) {
        console.error('Error processing audio:', error);
        await sendWhatsAppMessage(message.from, 'Sorry, there was an error transcribing the audio.');
      }
    } else if (message.type === 'text') {
      await handleUserResponse(message);
    } else {
      console.log('Received unsupported message type. Sending main menu.');
      await sendMainMenu(message.from);
    }
  } else if (event && event.type === 'statuses' && event.event === 'post') {
    console.log('Received status update:', req.body.statuses);
  } else {
    console.log('Received unhandled event type. No processing needed.');
  }

  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});