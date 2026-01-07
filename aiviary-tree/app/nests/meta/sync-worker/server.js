#!/usr/bin/env node

require('dotenv').config();
const cron = require('node-cron');
const db = require('./lib/db');
const logger = require('./lib/logger');
const jobQueue = require('./lib/jobQueue');
const { instagramRateLimiter } = require('./lib/rateLimiter');

// Configuration
const POLL_INTERVAL_MS = 60000; // 60 seconds
const DAILY_SYNC_CRON = '0 4 * * *'; // 4:00 AM daily
const CLEANUP_CRON = '0 2 * * 0'; // 2:00 AM every Sunday

let isShuttingDown = false;
let pollTimer = null;

/**
 * Main job processing loop
 * Polls for jobs every 60 seconds
 */
async function processJobLoop() {
  if (isShuttingDown) {
    logger.info('Shutdown in progress, skipping job poll');
    return;
  }

  try {
    const job = await jobQueue.getNextJob();

    if (job) {
      logger.info('Processing job from queue', {
        jobId: job.id,
        jobType: job.job_type,
        clientId: job.client_id,
      });

      await jobQueue.processJob(job);

      // Immediately check for another job (don't wait for next poll)
      setImmediate(() => processJobLoop());
    } else {
      // No jobs available, schedule next poll
      pollTimer = setTimeout(() => processJobLoop(), POLL_INTERVAL_MS);
    }
  } catch (error) {
    logger.error('Error in job processing loop', {
      error: error.message,
      stack: error.stack,
    });

    // Continue polling even after error (with backoff)
    pollTimer = setTimeout(() => processJobLoop(), POLL_INTERVAL_MS * 2);
  }
}

/**
 * Schedule daily sync jobs for all clients
 * Runs at 4:00 AM daily
 */
async function scheduleDailySyncJobs() {
  logger.info('Scheduling daily sync jobs for all clients');

  try {
    // Get all clients that have completed backfill
    const result = await db.query(`
      SELECT DISTINCT client_id
      FROM sync_status
      WHERE backfill_completed = TRUE
    `);

    let scheduledCount = 0;

    for (const row of result.rows) {
      const clientId = row.client_id;

      // Create daily sync job
      await jobQueue.createJob(clientId, 'daily_sync', 75); // Priority 75 (higher than backfill)

      scheduledCount++;
    }

    logger.info('Daily sync jobs scheduled', {
      count: scheduledCount,
    });
  } catch (error) {
    logger.error('Failed to schedule daily sync jobs', {
      error: error.message,
    });
  }
}

/**
 * Clean up old jobs
 * Runs at 2:00 AM every Sunday
 */
async function cleanupOldJobsCron() {
  logger.info('Running weekly job cleanup');

  try {
    const deletedCount = await jobQueue.cleanupOldJobs(30);
    logger.info('Weekly cleanup completed', { deletedCount });
  } catch (error) {
    logger.error('Failed to cleanup old jobs', {
      error: error.message,
    });
  }
}

/**
 * Log system stats periodically
 */
async function logStats() {
  try {
    const jobStats = await jobQueue.getJobStats();
    const rateLimiterStats = instagramRateLimiter.getStats();

    logger.info('System stats', {
      jobs: jobStats,
      rateLimiter: rateLimiterStats,
    });
  } catch (error) {
    logger.error('Failed to log stats', { error: error.message });
  }
}

/**
 * Graceful shutdown handler
 */
async function gracefulShutdown(signal) {
  logger.info('Received shutdown signal', { signal });
  isShuttingDown = true;

  // Clear poll timer
  if (pollTimer) {
    clearTimeout(pollTimer);
  }

  // Wait a bit for current job to finish (max 30 seconds)
  logger.info('Waiting for current job to finish (max 30s)...');
  await new Promise((resolve) => setTimeout(resolve, 30000));

  // Close database connection
  await db.close();

  logger.info('Sync worker shut down gracefully');
  process.exit(0);
}

/**
 * Main startup function
 */
async function main() {
  logger.info('Starting sync-worker', {
    nodeVersion: process.version,
    environment: process.env.NODE_ENV || 'development',
  });

  // Test database connection
  const dbOk = await db.testConnection();
  if (!dbOk) {
    logger.error('Database connection failed, exiting');
    process.exit(1);
  }

  // Log initial stats
  await logStats();

  // Schedule daily sync jobs (4:00 AM)
  logger.info('Scheduling daily sync cron', { schedule: DAILY_SYNC_CRON });
  cron.schedule(DAILY_SYNC_CRON, async () => {
    await scheduleDailySyncJobs();
  });

  // Schedule weekly cleanup (2:00 AM Sunday)
  logger.info('Scheduling weekly cleanup cron', { schedule: CLEANUP_CRON });
  cron.schedule(CLEANUP_CRON, async () => {
    await cleanupOldJobsCron();
  });

  // Schedule hourly stats logging
  cron.schedule('0 * * * *', async () => {
    await logStats();
  });

  // Start job processing loop
  logger.info('Starting job processing loop', {
    pollIntervalMs: POLL_INTERVAL_MS,
  });
  processJobLoop();

  // Setup graceful shutdown handlers
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // Handle uncaught errors
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Promise Rejection', {
      reason,
      promise,
    });
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception', {
      error: error.message,
      stack: error.stack,
    });

    // Exit on uncaught exception
    gracefulShutdown('uncaughtException');
  });

  logger.info('Sync worker started successfully');
}

// Start the server
main().catch((error) => {
  logger.error('Fatal error during startup', {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});
