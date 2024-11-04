const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config/config');
const logger = require('../utils/logger');
const mysql = require('mysql2/promise');
require('dotenv').config();

function getLocalMySQLPort() {
  const portFilePath = path.join(__dirname, '..', '..', '..', '.sql-port');
  try {
    if (fs.existsSync(portFilePath)) {
      return parseInt(fs.readFileSync(portFilePath, 'utf8').trim(), 10);
    }
  } catch (error) {
    logger.error('Error reading MySQL port file:', error);
  }
  return null;
}

function getLocalWPConfig() {
  return {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 10023
  };
}
const localConfig = getLocalWPConfig();

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || process.env.DATABASE_HOST,
  user: process.env.MYSQL_USER || process.env.DATABASE_USERNAME,
  password: process.env.MYSQL_PASSWORD || process.env.DATABASE_PASSWORD,
  database: process.env.MYSQL_DATABASE || process.env.DATABASE_NAME,
  port: parseInt(process.env.MYSQL_PORT || process.env.DATABASE_PORT, 10),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 30000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
});
async function waitForConnection(maxAttempts = 3) {
  let attempts = 0;
  while (attempts < maxAttempts) {
    try {
      const connection = await pool.getConnection();
      console.log('Database connection successful on attempt', attempts + 1);
      connection.release();
      return true;
    } catch (error) {
      attempts++;
      console.error(`Connection attempt ${attempts} failed:`, error.message);
      if (attempts < maxAttempts) {
        const delay = Math.min(1000 * Math.pow(2, attempts), 10000);
        console.log(`Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  return false;
}

console.log('Creating connection pool with config:', {
  host: process.env.MYSQL_HOST || process.env.DATABASE_HOST,
  user: process.env.MYSQL_USER || process.env.DATABASE_USERNAME,
  database: process.env.MYSQL_DATABASE || process.env.DATABASE_NAME,
  port: parseInt(process.env.MYSQL_PORT || process.env.DATABASE_PORT, 10)
});


// Normalize phone number
const normalizePhoneNumber = (phoneNumber) => {
  return phoneNumber.replace(/\D/g, '');
};

// Get user by phone number
async function getUser(phoneNumber) {
  console.log(`Attempting to get user with phone number: ${phoneNumber}`);
  try {
    const [rows] = await pool.query(`
      SELECT u.ID, u.user_email, 
             MAX(CASE WHEN m.meta_key = 'whatsapp_number' THEN m.meta_value END) as whatsapp_number,
             MAX(CASE WHEN m.meta_key = 'payment_plan' THEN m.meta_value END) as payment_plan,
             MAX(CASE WHEN m.meta_key = 'audio_minutes_limit' THEN CAST(m.meta_value AS DECIMAL(10,2)) END) as audio_minutes_limit,
             MAX(CASE WHEN m.meta_key = 'audio_minutes_used' THEN CAST(m.meta_value AS DECIMAL(10,2)) END) as audio_minutes_used,
             MAX(CASE WHEN m.meta_key = 'subscription_end_date' THEN m.meta_value END) as subscription_end_date
      FROM wp_users u
      JOIN wp_usermeta m ON u.ID = m.user_id
      WHERE m.meta_key = 'whatsapp_number' AND m.meta_value = ?
      GROUP BY u.ID
    `, [phoneNumber]);
    
    console.log(`Query result for ${phoneNumber}:`, JSON.stringify(rows));
    
    if (rows.length === 0) {
      console.log(`No user found for phone number: ${phoneNumber}`);
      return null;
    }
    
    console.log(`User found for ${phoneNumber}:`, JSON.stringify(rows[0]));
    return rows[0];
  } catch (error) {
    console.error(`Error in getUser for ${phoneNumber}:`, error);
    throw error;
  }
}


// Register a new user
async function registerUser(phoneNumber) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Check if user already exists
    const [existingUser] = await connection.query(
      'SELECT * FROM wp_users u JOIN wp_usermeta m ON u.ID = m.user_id WHERE m.meta_key = "whatsapp_number" AND m.meta_value = ?',
      [phoneNumber]
    )

    if (existingUser.length > 0) {
      return existingUser[0];
    }

    // If user doesn't exist, create a new one
    const [result] = await connection.query(
      'INSERT INTO wp_users (user_login, user_pass, user_nicename, user_email, user_registered) VALUES (?, ?, ?, ?, NOW())',
      [phoneNumber, Math.random().toString(36).slice(-8), phoneNumber, `${phoneNumber}@example.com`]
    );
    const userId = result.insertId;

    // Add user meta
    await connection.query(
      'INSERT INTO wp_usermeta (user_id, meta_key, meta_value) VALUES ' +
      '(?, "whatsapp_number", ?), ' +
      '(?, "payment_plan", ?), ' +
      '(?, "audio_minutes_limit", ?), ' +
      '(?, "audio_minutes_used", ?)',
      [userId, phoneNumber, userId, 'free', userId, 10, userId, 0]
    );

    await connection.commit();

    return { userId, phoneNumber, payment_plan: 'free', audio_minutes_limit: 10, audio_minutes_used: 0 };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
// Add audio minutes to user
async function addAudioMinutes(phoneNumber, minutes) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const user = await getUser(phoneNumber);
    if (!user) {
      throw new Error('User not found');
    }

    const newTotalAllocatedTime = parseFloat(user.total_allocated_time) + minutes;

    await updateUserTime(user.ID, newTotalAllocatedTime, user.used_time_since_reset, user.last_reset_date);

    await connection.commit();

    return {
      newTotalAllocatedTime,
      addedMinutes: minutes
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
// new func
async function updateUserTime(userId, totalAllocatedTime, usedTimeSinceReset, lastResetDate) {
  await pool.query(`
    INSERT INTO wp_usermeta (user_id, meta_key, meta_value) 
    VALUES 
      (?, 'total_allocated_time', ?),
      (?, 'used_time_since_reset', ?),
      (?, 'last_reset_date', ?)
    ON DUPLICATE KEY UPDATE 
      meta_value = VALUES(meta_value)
  `, [userId, totalAllocatedTime, userId, usedTimeSinceReset, userId, lastResetDate]);
}
function shouldResetTime(user) {
  const now = new Date();
  const lastReset = new Date(user.last_reset_date);
  const resetPeriod = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

  return now - lastReset > resetPeriod;
}

async function resetUserTime(user) {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await updateUserTime(user.ID, user.total_allocated_time, 0, now);
  user.used_time_since_reset = 0;
  user.last_reset_date = now;
}


// Extend subscription
async function extendSubscription(phoneNumber, months) {
  try {
    const [user] = await pool.query('SELECT * FROM users WHERE phone_number = ?', [phoneNumber]);
    if (user.length === 0) {
      return { error: 'User not found' };
    }
    if (user[0].payment_plan !== 'subscription') {
      return { error: 'User is not on a subscription plan' };
    }
    const currentEndDate = user[0].subscription_end_date ? new Date(user[0].subscription_end_date) : new Date();
    const newEndDate = new Date(currentEndDate.getTime() + months * 30 * 24 * 60 * 60 * 1000);
    await pool.query(
      'UPDATE users SET subscription_end_date = ? WHERE phone_number = ?',
      [newEndDate, phoneNumber]
    );
    const [updatedUser] = await pool.query('SELECT * FROM users WHERE phone_number = ?', [phoneNumber]);
    return updatedUser[0];
  } catch (error) {
    logger.error(`Error in extendSubscription: ${error.message}`);
    throw error;
  }
}


// Check if user can use the service
async function canUseService(phoneNumber, durationInMinutes) {
  try {
    const user = await getUser(phoneNumber);
    if (!user) {
      return false;
    }
    
    const now = new Date();
    const resetPeriod = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
    
    // Check if we need to reset the usage
    const lastResetDate = user.last_reset_date ? new Date(user.last_reset_date) : new Date(0);
    if (now - lastResetDate > resetPeriod) {
      await pool.query(
        'UPDATE wp_usermeta SET meta_value = ? WHERE user_id = ? AND meta_key = "audio_minutes_used"',
        [0, user.ID]
      );
      await pool.query(
        'UPDATE wp_usermeta SET meta_value = ? WHERE user_id = ? AND meta_key = "last_reset_date"',
        [now.toISOString(), user.ID]
      );
      user.audio_minutes_used = 0;
    }

    const audioMinutesUsed = parseFloat(user.audio_minutes_used) || 0;
    const audioMinutesLimit = parseFloat(user.audio_minutes_limit) || 0;

    if (user.payment_plan === 'free') {
      return audioMinutesUsed + durationInMinutes <= audioMinutesLimit;
    }

    if (user.payment_plan === 'subscription') {
      const subscriptionEndDate = user.subscription_end_date ? new Date(user.subscription_end_date) : now;
      return now < subscriptionEndDate && 
             audioMinutesUsed + durationInMinutes <= audioMinutesLimit;
    }

    return audioMinutesUsed + durationInMinutes <= audioMinutesLimit;
  } catch (error) {
    logger.error(`Error in canUseService: ${error.message}`);
    throw error;
  }
}

// Use audio transcription service
async function useAudioTranscription(phoneNumber, durationInMinutes) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    logger.log(`Fetching user data for phone number: ${phoneNumber}`);
    const [users] = await connection.query(
      'SELECT u.ID, m1.meta_value AS audio_minutes_limit, m2.meta_value AS audio_minutes_used ' +
      'FROM wp_users u ' +
      'JOIN wp_usermeta m ON u.ID = m.user_id ' +
      'LEFT JOIN wp_usermeta m1 ON u.ID = m1.user_id AND m1.meta_key = "audio_minutes_limit" ' +
      'LEFT JOIN wp_usermeta m2 ON u.ID = m2.user_id AND m2.meta_key = "audio_minutes_used" ' +
      'WHERE m.meta_key = "whatsapp_number" AND m.meta_value = ?',
      [phoneNumber]
    );

    if (users.length === 0) {
      logger.error(`User not found for phone number: ${phoneNumber}`);
      throw new Error('User not found');
    }

    const user = users[0];
    logger.log(`User data retrieved: ${JSON.stringify(user)}`);

    const audioMinutesUsed = parseFloat(user.audio_minutes_used || '0') || 0;
    const audioMinutesLimit = parseFloat(user.audio_minutes_limit || '10') || 10;
    const newAudioMinutesUsed = audioMinutesUsed + durationInMinutes;

    logger.log(`Audio minutes calculation for ${phoneNumber}:`, {
    audioMinutesUsed,
    audioMinutesLimit,
    durationInMinutes,
    newAudioMinutesUsed
});

    if (newAudioMinutesUsed > audioMinutesLimit) {
      logger.log(`Insufficient time for user: ${phoneNumber}`);
      throw new Error('Insufficient time');
    }

    logger.log(`Updating audio minutes used for user ID: ${user.ID}`);
    const [updateResult] = await connection.query(
      'UPDATE wp_usermeta SET meta_value = ? WHERE user_id = ? AND meta_key = "audio_minutes_used"',
      [newAudioMinutesUsed.toFixed(2), user.ID]
    );

    logger.log(`Update result: ${JSON.stringify(updateResult)}`);

    await connection.commit();

    return {
      minutesUsed: durationInMinutes,
      timeLeft: audioMinutesLimit - newAudioMinutesUsed
    };
  } catch (error) {
    await connection.rollback();
    logger.error(`Error in useAudioTranscription: ${error.message}`);
    logger.error(`Error stack: ${error.stack}`);
    throw error;
  } finally {
    connection.release();
  }
}

async function testDatabaseConnection() {
  try {
    const success = await waitForConnection();
    if (!success) {
      console.error('All connection attempts failed');
      return false;
    }
    return true;
  } catch (error) {
    console.error('Database connection failed:', error);
    console.error('Error code:', error.code);
    console.error('Error number:', error.errno);
    console.error('SQL state:', error.sqlState);
    return false;
  }
}
async function verifyDatabaseStructure() {
  let connection;
  try {
    connection = await pool.getConnection();
    console.log('Connected to database for structure verification');
    
    const [databases] = await connection.query('SHOW DATABASES');
    console.log('Databases:', databases.map(db => db.Database));

    const [tables] = await connection.query('SHOW TABLES');
    console.log('Tables:', tables.map(table => table[`Tables_in_${process.env.DB_NAME}`]));

    if (tables.some(table => table[`Tables_in_${process.env.DB_NAME}`] === 'wp_users')) {
      const [usersStructure] = await connection.query('DESCRIBE wp_users');
      console.log('wp_users structure:', usersStructure);
    } else {
      console.log('wp_users table not found');
    }

    if (tables.some(table => table[`Tables_in_${process.env.DB_NAME}`] === 'wp_usermeta')) {
      const [usermetaStructure] = await connection.query('DESCRIBE wp_usermeta');
      console.log('wp_usermeta structure:', usermetaStructure);
    } else {
      console.log('wp_usermeta table not found');
    }
  } catch (error) {
    console.error('Error verifying database structure:', error);
  } finally {
    if (connection) connection.release();
  }
}
async function getUserTimeUsage(phoneNumber) {
  try {
    const user = await getUser(phoneNumber);
    if (!user) {
      logger.error(`User not found in getUserTimeUsage for ${phoneNumber}`);
      throw new Error('User not found');
    }

    const [rows] = await pool.query(`
      SELECT 
        MAX(CASE WHEN m.meta_key = 'audio_minutes_limit' THEN CAST(m.meta_value AS DECIMAL(10,2)) END) as total_time,
        MAX(CASE WHEN m.meta_key = 'audio_minutes_used' THEN CAST(m.meta_value AS DECIMAL(10,2)) END) as used_time
      FROM wp_usermeta m
      WHERE m.user_id = ?
    `, [user.ID]);

    const totalTime = parseFloat(rows[0].total_time || '10') || 10;
    const usedTime = parseFloat(rows[0].used_time || '0') || 0;
    const timeLeft = Math.max(0, totalTime - usedTime);

    logger.log(`Time usage calculation for ${phoneNumber}:`, {
      totalTime,
      usedTime,
      timeLeft
    });

    return { totalTime, usedTime, timeLeft };
  } catch (error) {
    logger.error(`Error in getUserTimeUsage for ${phoneNumber}:`, error);
    throw error;
  }
}
async function useDocumentProcessing(phoneNumber, processedLength) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [users] = await connection.query(
      'SELECT u.ID, m1.meta_value AS document_units_limit, m2.meta_value AS document_units_used ' +
      'FROM wp_users u ' +
      'JOIN wp_usermeta m ON u.ID = m.user_id ' +
      'LEFT JOIN wp_usermeta m1 ON u.ID = m1.user_id AND m1.meta_key = "document_units_limit" ' +
      'LEFT JOIN wp_usermeta m2 ON u.ID = m2.user_id AND m2.meta_key = "document_units_used" ' +
      'WHERE m.meta_key = "whatsapp_number" AND m.meta_value = ?',
      [phoneNumber]
    );

    if (users.length === 0) {
      throw new Error('User not found');
    }

    const user = users[0];
    const documentUnitsUsed = parseFloat(user.document_units_used || '0');
    const documentUnitsLimit = parseFloat(user.document_units_limit || '1000');
    const newDocumentUnitsUsed = documentUnitsUsed + (processedLength / 1000);

    if (newDocumentUnitsUsed > documentUnitsLimit) {
      throw new Error('Insufficient units');
    }

    await connection.query(
      'UPDATE wp_usermeta SET meta_value = ? WHERE user_id = ? AND meta_key = "document_units_used"',
      [newDocumentUnitsUsed.toFixed(2), user.ID]
    );

    await connection.commit();

    return {
      unitsUsed: processedLength / 1000,
      unitsLeft: documentUnitsLimit - newDocumentUnitsUsed
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
async function setDefaultUserValues(userId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const defaultValues = {
      payment_plan: 'free',
      audio_minutes_limit: '10',
      audio_minutes_used: '0',
      document_units_limit: '1000',
      document_units_used: '0'
    };

    for (const [key, value] of Object.entries(defaultValues)) {
      await connection.query(
        'INSERT INTO wp_usermeta (user_id, meta_key, meta_value) VALUES (?, ?, ?) ' +
        'ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)',
        [userId, key, value]
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}


module.exports = {
  registerUser,
  getUser,
  extendSubscription,
  canUseService,
  normalizePhoneNumber,
  useAudioTranscription,
  addAudioMinutes,
  testDatabaseConnection,
  getLocalWPConfig,
  getLocalMySQLPort,
  verifyDatabaseStructure,
  updateUserTime,
  getUserTimeUsage,
  useDocumentProcessing,
  setDefaultUserValues
};