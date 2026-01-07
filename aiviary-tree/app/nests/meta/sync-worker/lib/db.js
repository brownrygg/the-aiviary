const { Pool } = require('pg');
const logger = require('./logger');

// PostgreSQL connection pool
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'postgres',
  port: process.env.POSTGRES_PORT || 5432,
  database: process.env.POSTGRES_DB || 'n8n_db',
  user: process.env.POSTGRES_USER || 'n8n',
  password: process.env.POSTGRES_PASSWORD,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000, // Increased from 2s to 10s
});

// Log pool stats
setInterval(() => {
  logger.debug('Pool stats', {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  });
}, 10000);

// Test connection on startup
pool.on('connect', () => {
  logger.info('New database connection established');
});

pool.on('error', (err) => {
  logger.error('Unexpected database pool error', { error: err.message });
});

/**
 * Execute a query with automatic error handling
 */
async function query(text, params = []) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug('Query executed', { duration, rows: result.rowCount });
    return result;
  } catch (error) {
    logger.error('Database query error', {
      error: error.message,
      query: text,
      params,
    });
    throw error;
  }
}

/**
 * Execute a transaction with automatic BEGIN/COMMIT/ROLLBACK
 */
async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    logger.debug('Transaction BEGIN');

    const result = await callback(client);

    await client.query('COMMIT');
    logger.debug('Transaction COMMIT');

    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Transaction ROLLBACK', { error: error.message });
    throw error;
  } finally {
    client.release();
    logger.debug('Transaction client released');
  }
}

/**
 * Get a client from the pool (for backward compatibility)
 * DEPRECATED: Use transaction() instead
 */
async function getClient() {
  return await pool.connect();
}

/**
 * Test database connection
 */
async function testConnection() {
  try {
    const result = await query('SELECT NOW() as current_time');
    logger.info('Database connection test successful', {
      serverTime: result.rows[0].current_time,
    });
    return true;
  } catch (error) {
    logger.error('Database connection test failed', { error: error.message });
    return false;
  }
}

/**
 * Gracefully close the pool
 */
async function close() {
  try {
    await pool.end();
    logger.info('Database pool closed');
  } catch (error) {
    logger.error('Error closing database pool', { error: error.message });
  }
}

module.exports = {
  query,
  transaction,
  getClient, // DEPRECATED
  testConnection,
  close,
  pool,
};
