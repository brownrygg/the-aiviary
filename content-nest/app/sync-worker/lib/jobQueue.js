const db = require('./db');
const logger = require('./logger');
const backfillJob = require('../jobs/backfill');
const dailySyncJob = require('../jobs/dailySync');

/**
 * Get next available job from queue using FOR UPDATE SKIP LOCKED
 * This ensures only one worker processes each job
 */
async function getNextJob() {
  return await db.transaction(async (client) => {
    // Get highest priority pending job and lock it atomically
    const result = await client.query(`
      UPDATE sync_jobs
      SET
        status = 'processing',
        started_at = NOW(),
        updated_at = NOW()
      WHERE id = (
        SELECT id
        FROM sync_jobs
        WHERE status = 'pending'
        ORDER BY priority DESC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING *
    `);

    if (result.rows.length === 0) {
      return null;
    }

    const job = result.rows[0];
    logger.job(job.id, 'Job locked for processing', {
      jobType: job.job_type,
      clientId: job.client_id,
      priority: job.priority,
    });

    return job;
  });
}

/**
 * Mark job as completed
 */
async function completeJob(jobId, result = null) {
  try {
    await db.query(
      `
      UPDATE sync_jobs
      SET
        status = 'completed',
        completed_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
    `,
      [jobId]
    );

    logger.job(jobId, 'Job completed successfully');
  } catch (error) {
    logger.error('Failed to mark job as completed', {
      jobId,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Mark job as failed and handle retry logic
 */
async function failJob(jobId, error, maxRetries = 3) {
  return await db.transaction(async (client) => {
    // Get current job state
    const jobResult = await client.query('SELECT retry_count FROM sync_jobs WHERE id = $1', [jobId]);

    if (jobResult.rows.length === 0) {
      throw new Error(`Job ${jobId} not found`);
    }

    const currentRetryCount = jobResult.rows[0].retry_count || 0;
    const newRetryCount = currentRetryCount + 1;

    // Determine if we should retry or fail permanently
    if (newRetryCount < maxRetries) {
      // Reset to pending for retry with exponential backoff
      const backoffMinutes = Math.pow(2, newRetryCount) * 5; // 5, 10, 20 minutes

      await client.query(
        `
        UPDATE sync_jobs
        SET
          status = 'pending',
          retry_count = $2,
          error_message = $3,
          updated_at = NOW(),
          started_at = NOW() + INTERVAL '${backoffMinutes} minutes'
        WHERE id = $1
      `,
        [jobId, newRetryCount, error.message]
      );

      logger.warn('Job failed, scheduled for retry', {
        jobId,
        retryCount: newRetryCount,
        maxRetries,
        backoffMinutes,
        error: error.message,
      });
    } else {
      // Max retries reached, mark as failed permanently
      await client.query(
        `
        UPDATE sync_jobs
        SET
          status = 'failed',
          retry_count = $2,
          error_message = $3,
          completed_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
      `,
        [jobId, newRetryCount, error.message]
      );

      logger.error('Job failed permanently after max retries', {
        jobId,
        retryCount: newRetryCount,
        error: error.message,
      });
    }
  });
}

/**
 * Process a job based on its type
 */
async function processJob(job) {
  logger.job(job.id, 'Processing job', {
    jobType: job.job_type,
    clientId: job.client_id,
  });

  try {
    let result;

    switch (job.job_type) {
      case 'backfill':
        result = await backfillJob.execute(job);
        break;

      case 'daily_sync':
        result = await dailySyncJob.execute(job);
        break;

      default:
        throw new Error(`Unknown job type: ${job.job_type}`);
    }

    await completeJob(job.id, result);

    logger.job(job.id, 'Job processing completed', {
      jobType: job.job_type,
      duration: Date.now() - new Date(job.started_at).getTime(),
    });

    return result;
  } catch (error) {
    logger.error('Job processing failed', {
      jobId: job.id,
      jobType: job.job_type,
      clientId: job.client_id,
      error: error.message,
      stack: error.stack,
    });

    await failJob(job.id, error);
    throw error;
  }
}

/**
 * Create a new job
 */
async function createJob(clientId, jobType, priority = 50, jobPayload = {}) {
  try {
    const result = await db.query(
      `
      INSERT INTO sync_jobs (client_id, job_type, priority, job_payload)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `,
      [clientId, jobType, priority, JSON.stringify(jobPayload)]
    );

    const job = result.rows[0];

    logger.job(job.id, 'Job created', {
      jobType,
      clientId,
      priority,
    });

    return job;
  } catch (error) {
    logger.error('Failed to create job', {
      jobType,
      clientId,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Get job statistics
 */
async function getJobStats() {
  try {
    const result = await db.query(`
      SELECT
        status,
        COUNT(*) as count
      FROM sync_jobs
      GROUP BY status
    `);

    const stats = {};
    result.rows.forEach((row) => {
      stats[row.status] = parseInt(row.count);
    });

    return stats;
  } catch (error) {
    logger.error('Failed to get job stats', { error: error.message });
    return {};
  }
}

/**
 * Clean up old completed/failed jobs (older than 30 days)
 */
async function cleanupOldJobs(daysToKeep = 30) {
  try {
    const result = await db.query(
      `
      DELETE FROM sync_jobs
      WHERE
        status IN ('completed', 'failed')
        AND updated_at < NOW() - INTERVAL '${daysToKeep} days'
    `
    );

    logger.info('Cleaned up old jobs', {
      deletedCount: result.rowCount,
      daysToKeep,
    });

    return result.rowCount;
  } catch (error) {
    logger.error('Failed to cleanup old jobs', { error: error.message });
    throw error;
  }
}

module.exports = {
  getNextJob,
  processJob,
  completeJob,
  failJob,
  createJob,
  getJobStats,
  cleanupOldJobs,
};
