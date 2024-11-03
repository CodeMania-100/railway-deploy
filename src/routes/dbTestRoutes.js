const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');

router.get('/test-db', async (req, res) => {
  const config = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    connectTimeout: 60000
  };

  console.log('Testing connection with config:', {
    host: config.host,
    user: config.user,
    database: config.database,
    port: config.port
  });

  try {
    // Create a connection
    const connection = await mysql.createConnection(config);
    console.log('Connection created successfully');

    // Test the connection with a simple query
    const [rows] = await connection.execute('SELECT 1 + 1 AS result');
    console.log('Test query executed successfully:', rows);

    // Close the connection
    await connection.end();
    console.log('Connection closed successfully');

    res.json({
      success: true,
      message: 'Database connection successful',
      testResult: rows[0]
    });
  } catch (error) {
    console.error('Database connection error:', {
      message: error.message,
      code: error.code,
      errno: error.errno,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage
    });

    res.status(500).json({
      success: false,
      error: error.message,
      details: {
        code: error.code,
        errno: error.errno,
        sqlState: error.sqlState
      }
    });
  }
});

module.exports = router;