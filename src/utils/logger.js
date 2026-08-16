/**
 * Logger Module
 * 
 * Centralized logging system for the Follow-Swarm application using Winston.
 * Provides structured logging with different levels, formats, and transports.
 * Supports console output with colors in development and file logging in production.
 */

const winston = require('winston');
const config = require('../../config');

// Define custom log levels with priority values (lower = more important)
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4
};

// Color scheme for console output in development
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue'
};

// Apply color configuration to Winston
winston.addColors(colors);

// Default format for structured logging (JSON format for production)
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), // Add timestamp
  winston.format.errors({ stack: true }), // Include stack traces for errors
  winston.format.splat(), // String interpolation support
  winston.format.json() // Output as JSON for easy parsing
);

// Human-readable format for development console output
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }), // Apply colors to all output
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  // Custom format function for readable console output
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    // Format metadata if present
    let metaStr = '';
    if (Object.keys(meta).length > 0) {
      metaStr = JSON.stringify(meta, null, 2); // Pretty print metadata
    }
    return `${timestamp} [${level}]: ${message} ${metaStr}`;
  })
);

// Configure logging transports (where logs are sent)
const transports = [
  // Console transport: Shows logs in terminal
  new winston.transports.Console({
    format: config.server.env === 'development' ? consoleFormat : format, // Use colors in dev
    level: config.logging.level // Minimum level to log
  })
];

// Production: Add persistent file logging for audit trail and debugging
if (config.server.env === 'production') {
  transports.push(
    // Error log file: Critical issues only
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error', // Only error level and above
      maxsize: 5242880, // 5MB per file
      maxFiles: 5, // Keep 5 rotated files
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      )
    }),
    // Combined log file: All log levels
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB per file
      maxFiles: 5, // Keep 5 rotated files
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      )
    })
  );
}

// Development: Add file logging for debugging if needed
if (config.server.env === 'development' && process.env.LOG_TO_FILE === 'true') {
  transports.push(
    new winston.transports.File({
      filename: 'logs/development.log',
      maxsize: 5242880, // 5MB per file
      maxFiles: 2, // Keep 2 files in development
      format: consoleFormat
    })
  );
}

// Create the main logger instance
const logger = winston.createLogger({
  levels: logLevels, // Use custom log levels
  format, // Default format
  transports, // Output destinations
  exitOnError: false // Don't exit on handled exceptions
});

logger.format.timestamp = true;

if (process.env.NODE_ENV === 'test') {
  logger.transports.forEach((transport) => {
    if (transport instanceof winston.transports.Console) {
      transport.silent = true;
    }
  });
}

/**
 * Stream adapter for Morgan HTTP request logging
 * Allows Express middleware to write HTTP logs through Winston
 */
logger.stream = {
  write: (message) => {
    // Remove trailing newline and log as HTTP level
    logger.http(message.trim());
  }
};

/**
 * Helper function to sanitize sensitive data from logs
 * @param {Object} data - Data to sanitize
 * @returns {Object} Sanitized data
 */
const sanitize = (data) => {
  if (!data || typeof data !== 'object') return data;
  
  const sanitized = { ...data };
  const sensitiveKeys = ['password', 'token', 'secret', 'key', 'authorization', 'cookie'];
  
  Object.keys(sanitized).forEach(key => {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof sanitized[key] === 'object') {
      sanitized[key] = sanitize(sanitized[key]);
    }
  });
  
  return sanitized;
};

/**
 * Enhanced logger methods with automatic sanitization
 */
const originalInfo = logger.info.bind(logger);
const originalError = logger.error.bind(logger);
const originalWarn = logger.warn.bind(logger);
const originalDebug = logger.debug.bind(logger);
const originalHttp = logger.http.bind(logger);

logger.info = (message, meta) => originalInfo(message, sanitize(meta));
logger.error = (message, meta) => originalError(message, sanitize(meta));
logger.warn = (message, meta) => originalWarn(message, sanitize(meta));
logger.debug = (message, meta) => originalDebug(message, sanitize(meta));
logger.http = (message, meta) => originalHttp(message, sanitize(meta));

module.exports = logger;
