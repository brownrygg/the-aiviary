const logger = require('./logger');

/**
 * Rate limiter using sliding window algorithm
 * Meta API limit: 200 requests/hour
 * Our safety limit: 180 requests/hour (10% buffer)
 */
class RateLimiter {
  constructor(maxRequests = 180, windowMs = 60 * 60 * 1000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs; // 1 hour in milliseconds
    this.requests = []; // Array of timestamps
  }

  /**
   * Remove timestamps outside the current window
   */
  cleanOldRequests() {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    this.requests = this.requests.filter((timestamp) => timestamp > cutoff);
  }

  /**
   * Check if we can make a request
   */
  canMakeRequest() {
    this.cleanOldRequests();
    return this.requests.length < this.maxRequests;
  }

  /**
   * Get remaining requests in current window
   */
  getRemainingRequests() {
    this.cleanOldRequests();
    return this.maxRequests - this.requests.length;
  }

  /**
   * Get time until next available request slot
   */
  getTimeUntilNextSlot() {
    if (this.canMakeRequest()) {
      return 0;
    }

    this.cleanOldRequests();

    if (this.requests.length === 0) {
      return 0;
    }

    // Time until oldest request falls out of window
    const oldestRequest = this.requests[0];
    const timeUntilSlotAvailable = oldestRequest + this.windowMs - Date.now();

    return Math.max(0, timeUntilSlotAvailable);
  }

  /**
   * Wait until we can make a request
   */
  async waitForSlot() {
    const waitTime = this.getTimeUntilNextSlot();

    if (waitTime > 0) {
      logger.warn('Rate limit reached, waiting for slot', {
        waitTimeMs: waitTime,
        waitTimeSeconds: Math.ceil(waitTime / 1000),
        currentRequests: this.requests.length,
        maxRequests: this.maxRequests,
      });

      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }

  /**
   * Record a request
   */
  recordRequest() {
    this.cleanOldRequests();
    this.requests.push(Date.now());

    logger.debug('API request recorded', {
      totalRequests: this.requests.length,
      remainingRequests: this.getRemainingRequests(),
    });
  }

  /**
   * Execute an async function with rate limiting
   */
  async execute(fn, context = null) {
    await this.waitForSlot();
    this.recordRequest();

    try {
      if (context) {
        return await fn.call(context);
      }
      return await fn();
    } catch (error) {
      // Check if it's a rate limit error from Meta API
      if (error.response?.status === 429 || error.message?.includes('rate limit')) {
        logger.error('Meta API rate limit error - backing off', {
          error: error.message,
          currentRequests: this.requests.length,
        });

        // Clear recent requests and wait 5 minutes
        this.requests = [];
        await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));

        // Retry once
        this.recordRequest();
        if (context) {
          return await fn.call(context);
        }
        return await fn();
      }

      throw error;
    }
  }

  /**
   * Get current stats
   */
  getStats() {
    this.cleanOldRequests();
    return {
      totalRequests: this.requests.length,
      maxRequests: this.maxRequests,
      remainingRequests: this.getRemainingRequests(),
      utilizationPercent: Math.round((this.requests.length / this.maxRequests) * 100),
      windowMs: this.windowMs,
    };
  }

  /**
   * Reset the rate limiter
   */
  reset() {
    this.requests = [];
    logger.info('Rate limiter reset');
  }
}

// Create a singleton instance for Instagram Graph API
const instagramRateLimiter = new RateLimiter(180, 60 * 60 * 1000);

module.exports = {
  RateLimiter,
  instagramRateLimiter,
};
