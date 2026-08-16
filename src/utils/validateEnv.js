/**
 * Environment Variable Validation
 * 
 * Validates all required environment variables on application startup.
 * Prevents runtime errors by ensuring all necessary configuration is present.
 */

const logger = require('./logger');

/**
 * Environment variable schema definition
 * Defines required and optional variables with their validation rules
 */
const envSchema = {
  // Server Configuration
  NODE_ENV: {
    required: false,
    default: 'development',
    values: ['development', 'production', 'test'],
    description: 'Application environment'
  },
  PORT: {
    required: false,
    default: '3001',
    type: 'port',
    description: 'Server port'
  },
  HOST: {
    required: false,
    default: 'localhost',
    description: 'Server host'
  },
  CORS_ALLOWED_ORIGINS: {
    required: false,
    type: 'url_list',
    description: 'Comma-separated list of allowed CORS origins'
  },

  // Spotify API (Required)
  SPOTIFY_CLIENT_ID: {
    required: true,
    type: 'string',
    description: 'Spotify application client ID'
  },
  SPOTIFY_CLIENT_SECRET: {
    required: true,
    type: 'string',
    sensitive: true,
    description: 'Spotify application client secret'
  },
  SPOTIFY_REDIRECT_URI: {
    required: true,
    type: 'url',
    description: 'Spotify OAuth callback URL'
  },

  // Database Configuration (Required)
  DATABASE_URL: {
    required: true,
    type: 'postgres_url',
    sensitive: true,
    description: 'PostgreSQL connection string'
  },
  DATABASE_HOST: {
    required: false,
    default: 'localhost',
    description: 'Database host'
  },
  DATABASE_PORT: {
    required: false,
    default: '5432',
    type: 'port',
    description: 'Database port'
  },
  DATABASE_NAME: {
    required: false,
    default: 'spotify_swarm',
    description: 'Database name'
  },
  DATABASE_USER: {
    required: false,
    default: 'postgres',
    description: 'Database user'
  },
  DATABASE_PASSWORD: {
    required: false,
    sensitive: true,
    description: 'Database password'
  },

  // Redis Configuration
  REDIS_URL: {
    required: false,
    default: 'redis://localhost:6379',
    type: 'redis_url',
    description: 'Redis connection string'
  },
  REDIS_HOST: {
    required: false,
    default: 'localhost',
    description: 'Redis host'
  },
  REDIS_PORT: {
    required: false,
    default: '6379',
    type: 'port',
    description: 'Redis port'
  },

  // Security Keys (Required)
  JWT_SECRET: {
    required: true,
    type: 'string',
    minLength: 32,
    sensitive: true,
    description: 'JWT signing secret (min 32 chars)'
  },
  ENCRYPTION_KEY: {
    required: true,
    type: 'string',
    minLength: 32,
    sensitive: true,
    description: 'Data encryption key (min 32 chars)'
  },
  SESSION_SECRET: {
    required: true,
    type: 'string',
    minLength: 32,
    sensitive: true,
    description: 'Session signing secret (min 32 chars)'
  },

  // Rate Limiting
  MAX_FOLLOWS_PER_HOUR: {
    required: false,
    default: '30',
    type: 'number',
    description: 'Maximum follows per hour'
  },
  MAX_FOLLOWS_PER_DAY: {
    required: false,
    default: '500',
    type: 'number',
    description: 'Maximum follows per day'
  },
  MAX_FOLLOWS_PER_MONTH: {
    required: false,
    default: '10000',
    type: 'number',
    description: 'Maximum follows per month'
  },

  // Queue Configuration
  QUEUE_CONCURRENCY: {
    required: false,
    default: '1',
    type: 'number',
    description: 'Queue processing concurrency'
  },
  MAX_JOB_ATTEMPTS: {
    required: false,
    default: '3',
    type: 'number',
    description: 'Maximum job retry attempts'
  },

  // Admin Configuration
  ADMIN_EMAILS: {
    required: false,
    default: 'admin@followswarm.com',
    type: 'email_list',
    description: 'Comma-separated list of admin emails'
  },

  // Optional Services
  SENTRY_DSN: {
    required: false,
    type: 'url',
    description: 'Sentry error tracking DSN'
  },
  STRIPE_SECRET_KEY: {
    required: false,
    type: 'string',
    sensitive: true,
    description: 'Stripe secret key for payments'
  },
  STRIPE_PUBLISHABLE_KEY: {
    required: false,
    type: 'string',
    description: 'Stripe publishable key'
  },
  STRIPE_WEBHOOK_SECRET: {
    required: false,
    type: 'string',
    sensitive: true,
    description: 'Stripe webhook signing secret'
  },

  // Email Service
  SMTP_HOST: {
    required: false,
    type: 'string',
    description: 'SMTP server host'
  },
  SMTP_PORT: {
    required: false,
    default: '587',
    type: 'port',
    description: 'SMTP server port'
  },
  SMTP_USER: {
    required: false,
    type: 'string',
    description: 'SMTP username'
  },
  SMTP_PASSWORD: {
    required: false,
    type: 'string',
    sensitive: true,
    description: 'SMTP password'
  },
  EMAIL_FROM: {
    required: false,
    default: 'noreply@followswarm.com',
    type: 'email',
    description: 'Default from email address'
  },

  // Logging
  LOG_LEVEL: {
    required: false,
    default: 'info',
    values: ['error', 'warn', 'info', 'debug', 'verbose'],
    description: 'Logging level'
  },

  // Feature Flags
  ENABLE_REDIS_RATE_LIMIT: {
    required: false,
    default: 'false',
    values: ['true', 'false'],
    description: 'Enable Redis-backed shared rate limiting'
  }
};

/**
 * Validation functions for different types
 */
const validators = {
  string: (value) => typeof value === 'string' && value.length > 0,
  
  number: (value) => {
    const num = parseInt(value, 10);
    return !isNaN(num) && num >= 0;
  },
  
  port: (value) => {
    const port = parseInt(value, 10);
    return !isNaN(port) && port > 0 && port <= 65535;
  },
  
  url: (value) => {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  },
  
  postgres_url: (value) => {
    return value.startsWith('postgresql://') || value.startsWith('postgres://');
  },
  
  redis_url: (value) => {
    return value.startsWith('redis://') || value.startsWith('rediss://');
  },
  
  email: (value) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(value);
  },
  
  email_list: (value) => {
    const emails = value.split(',').map(e => e.trim());
    return emails.every(email => validators.email(email));
  },

  url_list: (value) => {
    const urls = value.split(',').map(url => url.trim()).filter(Boolean);

    if (urls.length === 0) {
      return false;
    }

    return urls.every(url => validators.url(url));
  }
};

/**
 * Validates all environment variables according to schema
 * @returns {Object} Validation result with errors and warnings
 */
function validateEnvironment() {
  const errors = [];
  const warnings = [];
  const missing = [];
  
  // Track which variables are set
  const envVars = {};
  
  for (const [key, schema] of Object.entries(envSchema)) {
    const value = process.env[key];
    
    // Check if required variable is missing
    if (schema.required && !value) {
      missing.push(key);
      errors.push(`Missing required environment variable: ${key} - ${schema.description}`);
      continue;
    }
    
    // Set default value if not provided
    if (!value && schema.default !== undefined) {
      process.env[key] = schema.default;
      envVars[key] = schema.default;
      continue;
    }
    
    // Skip validation if not provided and not required
    if (!value) {
      continue;
    }
    
    envVars[key] = schema.sensitive ? '[REDACTED]' : value;
    
    // Validate allowed values
    if (schema.values && !schema.values.includes(value)) {
      errors.push(`Invalid value for ${key}: "${value}". Allowed values: ${schema.values.join(', ')}`);
    }
    
    // Validate type
    if (schema.type && validators[schema.type]) {
      if (!validators[schema.type](value)) {
        errors.push(`Invalid ${schema.type} for ${key}: "${schema.sensitive ? '[REDACTED]' : value}"`);
      }
    }
    
    // Validate minimum length
    if (schema.minLength && value.length < schema.minLength) {
      errors.push(`${key} must be at least ${schema.minLength} characters long`);
    }
  }
  
  // Add warnings for optional but recommended variables
  if (!process.env.SENTRY_DSN) {
    warnings.push('SENTRY_DSN not configured - Error tracking disabled');
  }
  
  if (!process.env.STRIPE_SECRET_KEY) {
    warnings.push('Stripe not configured - Payment features disabled');
  }
  
  if (!process.env.SMTP_HOST) {
    warnings.push('SMTP not configured - Email notifications disabled');
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    missing,
    configured: envVars
  };
}

/**
 * Generates a template .env file with all variables
 * @returns {string} Template content for .env file
 */
function generateEnvTemplate() {
  let template = '# Follow-Swarm Environment Configuration\n';
  template += '# Generated from environment schema\n\n';
  
  const categories = {
    'Server Configuration': ['NODE_ENV', 'PORT', 'HOST', 'CORS_ALLOWED_ORIGINS'],
    'Spotify API (Required)': ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_REDIRECT_URI'],
    'Database (Required)': ['DATABASE_URL', 'DATABASE_HOST', 'DATABASE_PORT', 'DATABASE_NAME', 'DATABASE_USER', 'DATABASE_PASSWORD'],
    'Redis Cache': ['REDIS_URL', 'REDIS_HOST', 'REDIS_PORT'],
    'Security (Required)': ['JWT_SECRET', 'ENCRYPTION_KEY', 'SESSION_SECRET'],
    'Rate Limiting': ['MAX_FOLLOWS_PER_HOUR', 'MAX_FOLLOWS_PER_DAY', 'MAX_FOLLOWS_PER_MONTH'],
    'Queue Configuration': ['QUEUE_CONCURRENCY', 'MAX_JOB_ATTEMPTS'],
    'Admin': ['ADMIN_EMAILS'],
    'Payment (Optional)': ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET'],
    'Email (Optional)': ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_FROM'],
    'Monitoring': ['SENTRY_DSN', 'LOG_LEVEL'],
    'Feature Flags': ['ENABLE_REDIS_RATE_LIMIT']
  };
  
  for (const [category, keys] of Object.entries(categories)) {
    template += `# ${category}\n`;
    
    for (const key of keys) {
      const schema = envSchema[key];
      if (!schema) continue;
      
      template += `# ${schema.description}`;
      if (schema.required) template += ' (REQUIRED)';
      if (schema.values) template += `\n# Allowed: ${schema.values.join(', ')}`;
      if (schema.minLength) template += `\n# Min length: ${schema.minLength} characters`;
      template += '\n';
      
      if (schema.default !== undefined) {
        template += `${key}=${schema.default}\n`;
      } else if (schema.type === 'string' || schema.type === 'url') {
        template += `${key}=your_${key.toLowerCase()}_here\n`;
      } else {
        template += `${key}=\n`;
      }
      template += '\n';
    }
  }
  
  return template;
}

/**
 * Main validation function to run on startup
 * @param {boolean} exitOnError - Whether to exit process on validation errors
 * @returns {boolean} Whether validation passed
 */
function validateOnStartup(exitOnError = true) {
  logger.info('Validating environment variables...');
  
  const result = validateEnvironment();
  
  // Log configured variables (with sensitive ones redacted)
  if (process.env.NODE_ENV !== 'test') {
    logger.debug('Environment variables configured:', result.configured);
  }
  
  // Log warnings
  result.warnings.forEach(warning => {
    logger.warn(`ENV Warning: ${warning}`);
  });
  
  // Handle errors
  if (!result.valid) {
    logger.error('Environment validation failed!');
    result.errors.forEach(error => {
      logger.error(`ENV Error: ${error}`);
    });
    
    if (result.missing.length > 0) {
      logger.error('\nMissing required environment variables:');
      result.missing.forEach(key => {
        const schema = envSchema[key];
        logger.error(`  - ${key}: ${schema.description}`);
      });
      logger.error('\nPlease check your .env file or environment configuration.');
      logger.error('Refer to .env.example for a complete template.');
    }
    
    if (exitOnError && process.env.NODE_ENV !== 'test') {
      process.exit(1);
    }
    
    return false;
  }
  
  logger.info('✅ Environment validation passed');
  return true;
}

module.exports = {
  validateEnvironment,
  validateOnStartup,
  generateEnvTemplate,
  envSchema
};
