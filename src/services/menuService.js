const { sendWhatsAppMessage } = require('../services/whatsappService');

async function sendMainMenu(to) {
  const menuText = `*👻 ברוכים הבאים!*

בחרו באחת האפשרויות הבאות:

1️⃣ תמלול הודעות טקסט
2️⃣ עיבוד מסמכים
3️⃣ שירותים נוספים
4️⃣ עלינו


_אנא השיבו עם המספר המתאים לבחירתכם_`;

try {
  await sendWhatsAppMessage(to, menuText);
  logger.log(`Main menu sent successfully to ${to}`);
} catch (error) {
  logger.error(`Error sending main menu to ${to}:`, error);
}

}

async function sendHelpMenu(to) {
  const helpText = `*📚 תפריט עזרה*

בחרו אחת מהאפשרויות הבאות:

1️⃣ איך להשתמש בבוט
2️⃣ שאלות נפוצות (FAQs)
3️⃣ תמיכה
4️⃣ חזרה לתפריט הראשי

_אנא השיבו עם המספר המתאים לבחירתכם_`;

  await sendWhatsAppMessage(to, helpText);
}

async function sendOtherServicesMenu(to) {
  const servicesText = `*🛠️ שירותים נוספים*

בחרו אחד מהשירותים הנוספים שלנו:

1️⃣ תרגום - תרגום מהיר ומדויק
2️⃣ סיכום טקסט ושיחות - קבלו תמצית של המידע
3️⃣ צרו תמונות - יצירת תמונות מטקסט
4️⃣ חזרה לתפריט הראשי

_אנא השיבו עם המספר המתאים לבחירתכם_`;

  await sendWhatsAppMessage(to, servicesText);
}

async function sendAboutUs(to) {
  const aboutText = `*עלינו*

תמללו הודעות כדי שלא תצטרכו לבזבז זמן להקשיב להן. אנחנו כאן כדי לחסוך לכם זמן יקר!

✅ מהירות מירבית
✅ דיוק גבוה
✅ ממשק ידידותי
✅ זמין 24/7

_להחזרה לתפריט הראשי, אנא הקלידו "מעעע"_`;

  await sendWhatsAppMessage(to, aboutText);
}

module.exports = {
  sendMainMenu,
  sendHelpMenu,
  sendOtherServicesMenu,
  sendAboutUs
};