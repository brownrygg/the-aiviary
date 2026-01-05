const winston = require('winston');

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

// Define log colors
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'blue',
};

winston.addColors(colors);

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'service'] }),
  winston.format.printf((info) => {
    let log = `${info.timestamp} [${info.level.toUpperCase()}] ${info.message}`;

    // Add metadata if present
    if (info.metadata && Object.keys(info.metadata).length > 0) {
      log += ` ${JSON.stringify(info.metadata)}`;
    }

    // Add stack trace for errors
    if (info.stack) {
      log += `\n${info.stack}`;
    }

    return log;
  })
);

// Create logger instance
const logger = winston.createLogger({
  levels,
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [
    // Console transport for all environments
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        logFormat
      ),
    }),
  ],
});

// Add file transport in production
if (process.env.NODE_ENV === 'production') {
  logger.add(
    new winston.transports.File({
      filename: '/app/logs/error.log',
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 5,
    })
  );

  logger.add(
    new winston.transports.File({
      filename: '/app/logs/combined.log',
      maxsize: 10485760, // 10MB
      maxFiles: 5,
    })
  );
}

// Helper methods for common logging scenarios
logger.job = (jobId, message, metadata = {}) => {
  logger.info(message, { jobId, ...metadata });
};

logger.api = (endpoint, message, metadata = {}) => {
  logger.debug(message, { endpoint, ...metadata });
};

logger.sync = (clientId, message, metadata = {}) => {
  logger.info(message, { clientId, ...metadata });
};

module.exports = logger;
