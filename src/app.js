const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const config = require('./config/config');
const webhookRoutes = require('./routes/webhookRoutes');
const { cleanupTempFiles } = require('./services/cleanupService');
const paymentRoutes = require('./routes/paymentRoutes');
const userService = require('./services/userService');
require('dotenv').config();
const dbTestRoutes = require('./routes/dbTestRoutes');

console.log('Database connection details:');
console.log('Host:', process.env.DB_HOST);
console.log('User:', process.env.DB_USER);
console.log('Password:', process.env.DB_PASSWORD);
console.log('Database:', process.env.DB_NAME);
console.log('Port:', process.env.DB_PORT || 3306);

const logger = require('./utils/logger');

console.log('Logger imported:', logger);
console.log('Logger type:', typeof logger);
console.log('Logger methods:', Object.keys(logger));

const app = express();
app.use(express.json());
app.use(bodyParser.json());

app.use('/api/payments', paymentRoutes);
app.use('/webhook', webhookRoutes);
app.use('/api', dbTestRoutes);
// Run cleanup on server start
cleanupTempFiles();

// Schedule cleanup to run periodically
setInterval(cleanupTempFiles, 3600000); // Run every hour

// Global error handler
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`);
  logger.error(`Stack trace: ${err.stack}`);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(config.port, async () => {
  if (typeof logger.log === 'function') {
    logger.log(`Server is running on port ${config.port}`);
  } else {
    console.log(`Server is running on port ${config.port}`);
    console.error('Logger.log is not a function');
  }
   // Test database connection with retries
   let connected = false;
   for(let i = 0; i < 3; i++) {
     try {
       await userService.testDatabaseConnection();
       connected = true;
       break;
     } catch (error) {
       console.error(`Database connection attempt ${i + 1} failed:`, error);
       if (i < 2) { // Don't wait on last attempt
         await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds between attempts
       }
     }
   }
   
   if (connected) {
     await userService.verifyDatabaseStructure();
   }
 
  
  // Test database connection and verify structure
  await userService.testDatabaseConnection();
  await userService.verifyDatabaseStructure();
});