/**
 * Express Application Setup
 * 
 * Configures and exports the Express application instance.
 * Separates app configuration from server startup for better testing.
 * 
 * @module app
 * @exports {Express} Configured Express application
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const path = require('path');

const config = require('../config');
const logger = require('./utils/logger');
const sessionMiddleware = require('./middleware/session');
const swagger = require('./swagger');
const { attachCsrfToken, validateCsrfToken, getCsrfToken } = require('./middleware/csrf');

// Create Express application instance
const app = express();

// Trust proxy headers (for deployment behind reverse proxy)
app.set('trust proxy', 1);

/**
 * Security Middleware Configuration
 */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://accounts.spotify.com", "https://api.spotify.com"]
    }
  }
}));

/**
 * CORS Configuration
 */
const allowedOrigins = Array.isArray(config.server.corsOrigin)
  ? config.server.corsOrigin
  : config.server.corsOrigin
    ? [config.server.corsOrigin]
    : [];

if (config.server.env === 'production' && allowedOrigins.length === 0) {
  logger.warn('No CORS allowed origins configured; cross-origin requests will be blocked until CORS_ALLOWED_ORIGINS is set.');
}

app.use(cors({
  origin: (origin, callback) => {
    if (config.server.env !== 'production') {
      return callback(null, true);
    }

    if (!origin) {
      // Allow same-origin or non-browser requests
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    logger.warn('Blocked CORS request from unauthorized origin', { origin });
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token']
}));

// Cookie parser (required for CSRF)
app.use(cookieParser());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Response compression
app.use(compression());

// HTTP request logging (skip in test environment)
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', { 
    stream: { 
      write: message => logger.http(message.trim()) 
    }
  }));
}

// Session management
app.use(sessionMiddleware);

// Session timeout monitoring
const { sessionTimeoutMiddleware } = require('./middleware/sessionTimeout');
app.use(sessionTimeoutMiddleware);

// CSRF Protection
// Skip CSRF for test environment to avoid breaking tests
if (process.env.NODE_ENV !== 'test') {
  app.use(attachCsrfToken);
  app.use(validateCsrfToken);
}

/**
 * CSRF Token Endpoint
 */
app.get('/api/csrf-token', getCsrfToken);

/**
 * Global Rate Limiting
 */
const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to all routes (skip during automated tests)
if (process.env.NODE_ENV !== 'test') {
  app.use('/api/', globalRateLimiter);
}

/**
 * Health Check Endpoint
 */
app.get('/health', async (req, res) => {
  const db = require('./database');
  const redis = require('./database/redis');
  
  // Perform health checks
  const dbHealth = await db.healthCheck();
  let redisHealth = { status: 'unknown' };
  
  try {
    await redis.client.ping();
    redisHealth = { status: 'healthy', message: 'Redis is responsive' };
  } catch (error) {
    redisHealth = { status: 'unhealthy', message: error.message };
  }
  
  // Determine overall health
  const isHealthy = dbHealth.status === 'healthy' && redisHealth.status === 'healthy';
  
  const health = {
    status: isHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.server.env,
    version: process.env.npm_package_version || '1.0.0',
    services: {
      database: dbHealth,
      redis: redisHealth
    }
  };
  
  res.status(isHealthy ? 200 : 503).json(health);
});

/**
 * API Documentation (skip in test environment)
 */
if (process.env.NODE_ENV !== 'test') {
  app.use('/api-docs', swagger.serve, swagger.setup);
}

/**
 * API Routes
 */
app.use('/auth', require('./api/auth.routes'));
app.use('/api/follows', require('./api/follow.routes'));
app.use('/api/admin', require('./api/admin.routes'));
app.use('/api/2fa', require('./routes/twoFactorAuth.routes'));
app.use('/api/session', require('./routes/session.routes'));

/**
 * Static Files (Production)
 */
if (config.server.env === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
  });
}

/**
 * 404 Handler
 */
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.url} not found`,
    timestamp: new Date().toISOString()
  });
});

/**
 * Global Error Handler
 */
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  
  const isDevelopment = config.server.env === 'development';
  
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    ...(isDevelopment && { stack: err.stack }),
    timestamp: new Date().toISOString()
  });
});

module.exports = app;
