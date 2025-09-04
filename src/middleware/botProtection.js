/**
 * Bot Protection Middleware
 * 
 * Implements multiple layers of bot detection and prevention including
 * rate limiting, honeypot fields, behavioral analysis, and suspicious
 * activity detection to prevent automated account creation.
 */

const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');
const db = require('../database');

/**
 * Rate limiter for signup/authentication attempts
 * Limits each IP to 3 signup attempts per 15 minutes
 * Skips rate limiting for already authenticated users (re-auth scenarios)
 */
const signupRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // Limit each IP to 3 requests per windowMs
  message: 'Too many signup attempts from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting if user is already authenticated (re-authentication)
    // Check for session user or JWT token
    if (req.session?.userId) {
      logger.debug('Skipping signup rate limit for authenticated session user');
      return true;
    }
    
    // Check for JWT in Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const jwt = require('jsonwebtoken');
        const config = require('../../config');
        const decoded = jwt.verify(token, config.security.jwtSecret);
        if (decoded.userId) {
          logger.debug('Skipping signup rate limit for JWT authenticated user');
          return true;
        }
      } catch (error) {
        // Invalid token, apply rate limiting
      }
    }
    
    return false;
  },
  handler: (req, res) => {
    logger.warn('Rate limit exceeded for signup', {
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
    res.status(429).json({
      error: 'Too many requests',
      message: 'You have made too many signup attempts. Please wait 15 minutes and try again.',
      retryAfter: 900 // seconds
    });
  }
});

/**
 * Rate limiter for OAuth callback attempts
 * Slightly more lenient as users might have connection issues
 * Also skips authenticated users for re-auth scenarios
 */
const oauthRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5, // Limit each IP to 5 OAuth attempts
  message: 'Too many authentication attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for authenticated users (re-authentication)
    if (req.session?.userId) {
      return true;
    }
    
    // Check for JWT token
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const jwt = require('jsonwebtoken');
        const config = require('../../config');
        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, config.security.jwtSecret);
        return !!decoded.userId;
      } catch (error) {
        // Invalid token, apply rate limiting
      }
    }
    
    return false;
  }
});

/**
 * General API rate limiter for authenticated users
 * More generous limits for logged-in users
 */
const apiRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute for authenticated users
  message: 'Too many requests, please slow down.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for admin users
    return req.user?.role === 'admin';
  }
});

/**
 * Honeypot field check middleware
 * Detects bots that fill invisible form fields
 */
const checkHoneypot = (req, res, next) => {
  // Check for honeypot fields that should be empty
  const honeypotFields = ['website', 'url', 'company', 'fax', 'phone_number'];
  
  for (const field of honeypotFields) {
    if (req.body[field]) {
      logger.warn('Honeypot field triggered', {
        field,
        value: req.body[field],
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });
      
      // Don't reveal it's a honeypot, just return generic error
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Please try again'
      });
    }
  }
  
  next();
};

/**
 * Track signup behavior and timing
 * Bots typically submit forms instantly while humans take time
 */
const trackSignupBehavior = (req, res, next) => {
  if (!req.session.signupMetrics) {
    req.session.signupMetrics = {
      pageLoadTime: Date.now(),
      interactionCount: 0,
      mouseEvents: 0,
      keyboardEvents: 0,
      focusEvents: 0
    };
  }
  
  // Track interaction events if sent from frontend
  if (req.body._metrics) {
    const metrics = req.body._metrics;
    req.session.signupMetrics.mouseEvents += metrics.mouseEvents || 0;
    req.session.signupMetrics.keyboardEvents += metrics.keyboardEvents || 0;
    req.session.signupMetrics.focusEvents += metrics.focusEvents || 0;
    req.session.signupMetrics.interactionCount++;
    
    // Remove metrics from body so it doesn't interfere with other processing
    delete req.body._metrics;
  }
  
  next();
};

/**
 * Analyze signup behavior to detect bots
 * Returns risk score between 0 (human) and 1 (bot)
 */
const analyzeSignupBehavior = (req) => {
  const metrics = req.session.signupMetrics;
  if (!metrics) return 0.5; // Unknown risk if no metrics
  
  const timeSincePageLoad = Date.now() - metrics.pageLoadTime;
  const riskFactors = [];
  
  // Time-based analysis
  if (timeSincePageLoad < 3000) {
    riskFactors.push(0.3); // Very fast submission
  } else if (timeSincePageLoad < 5000) {
    riskFactors.push(0.1); // Fast submission
  }
  
  // Interaction analysis
  if (metrics.mouseEvents === 0) {
    riskFactors.push(0.2); // No mouse movement
  }
  
  if (metrics.keyboardEvents === 0) {
    riskFactors.push(0.2); // No keyboard activity
  }
  
  if (metrics.focusEvents === 0) {
    riskFactors.push(0.1); // No focus events
  }
  
  if (metrics.interactionCount < 2) {
    riskFactors.push(0.1); // Very few interactions
  }
  
  // Calculate total risk score
  const riskScore = Math.min(1, riskFactors.reduce((a, b) => a + b, 0));
  
  return riskScore;
};

/**
 * Check if IP address is suspicious
 * Checks for VPNs, proxies, and known bad IPs
 */
const checkSuspiciousIP = async (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  
  try {
    // Check if IP is in our suspicious IPs database
    const result = await db.query(
      'SELECT * FROM suspicious_ips WHERE ip_address = $1 AND last_checked > NOW() - INTERVAL \'24 hours\'',
      [ip]
    );
    
    if (result.rows.length > 0) {
      const ipData = result.rows[0];
      if (ipData.risk_score > 80) {
        logger.warn('High-risk IP detected', { ip, riskScore: ipData.risk_score });
        return res.status(403).json({
          error: 'Access denied',
          message: 'Your connection appears to be from a restricted network'
        });
      }
    }
    
    // Add IP to session for tracking
    req.session.signupIP = ip;
    
  } catch (error) {
    logger.error('Error checking suspicious IP:', error);
    // Don't block on error, just continue
  }
  
  next();
};

/**
 * Verify Spotify account age and legitimacy
 * New or empty Spotify accounts are likely bots
 */
const verifySpotifyAccount = async (spotifyUser) => {
  const riskFactors = [];
  
  // Check account age (if available from Spotify API)
  // Note: Spotify doesn't provide account creation date directly
  // We can infer from other factors
  
  // Check follower count
  if (spotifyUser.followers?.total === 0) {
    riskFactors.push(0.2);
  }
  
  // Check if email is verified
  if (!spotifyUser.email) {
    riskFactors.push(0.3);
  }
  
  // Check if has profile image
  if (!spotifyUser.images || spotifyUser.images.length === 0) {
    riskFactors.push(0.1);
  }
  
  // Check display name
  if (!spotifyUser.display_name || spotifyUser.display_name === spotifyUser.id) {
    riskFactors.push(0.1);
  }
  
  // Check product type (free vs premium)
  if (spotifyUser.product === 'free') {
    riskFactors.push(0.05); // Slight risk increase for free accounts
  }
  
  return Math.min(1, riskFactors.reduce((a, b) => a + b, 0));
};

/**
 * Combined bot detection middleware
 * Analyzes multiple factors to determine if user is a bot
 */
const detectBot = async (req, res, next) => {
  try {
    // Skip bot detection for whitelisted IPs or admin users
    if (req.user?.role === 'admin') {
      return next();
    }
    
    // Calculate behavior risk score
    const behaviorRisk = analyzeSignupBehavior(req);
    
    // Store risk score in session
    req.session.riskScore = behaviorRisk;
    
    // If high risk, require additional verification
    if (behaviorRisk > 0.7) {
      logger.warn('High risk signup detected', {
        ip: req.ip,
        riskScore: behaviorRisk,
        userAgent: req.headers['user-agent']
      });
      
      return res.status(403).json({
        error: 'Verification required',
        message: 'Additional verification is required to complete signup',
        requiresCaptcha: true
      });
    }
    
    next();
  } catch (error) {
    logger.error('Bot detection error:', error);
    // Don't block on error
    next();
  }
};

/**
 * Log suspicious activity to database
 */
const logSuspiciousActivity = async (req, type, details) => {
  try {
    await db.query(
      `INSERT INTO security_logs (ip_address, user_agent, event_type, details, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [
        req.ip,
        req.headers['user-agent'],
        type,
        JSON.stringify(details)
      ]
    );
  } catch (error) {
    logger.error('Failed to log suspicious activity:', error);
  }
};

/**
 * Create required database tables for bot protection
 */
const initializeBotProtection = async () => {
  try {
    // Check if database is connected
    if (!db.pool) {
      logger.warn('Database not connected, skipping bot protection initialization');
      return;
    }
    
    // Create suspicious IPs table
    await db.query(`
      CREATE TABLE IF NOT EXISTS suspicious_ips (
        id SERIAL PRIMARY KEY,
        ip_address VARCHAR(45) UNIQUE NOT NULL,
        risk_score INTEGER DEFAULT 0,
        is_vpn BOOLEAN DEFAULT FALSE,
        is_proxy BOOLEAN DEFAULT FALSE,
        is_tor BOOLEAN DEFAULT FALSE,
        country_code VARCHAR(2),
        last_checked TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create security logs table
    await db.query(`
      CREATE TABLE IF NOT EXISTS security_logs (
        id SERIAL PRIMARY KEY,
        ip_address VARCHAR(45),
        user_agent TEXT,
        user_id UUID REFERENCES users(id),
        event_type VARCHAR(50),
        details JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Add bot protection fields to users table
    await db.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS risk_score DECIMAL(3,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS signup_ip VARCHAR(45),
      ADD COLUMN IF NOT EXISTS flagged_for_review BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS bot_detection_passed BOOLEAN DEFAULT TRUE
    `);
    
    logger.info('Bot protection tables initialized');
  } catch (error) {
    logger.error('Failed to initialize bot protection tables:', error);
  }
};

module.exports = {
  signupRateLimiter,
  oauthRateLimiter,
  apiRateLimiter,
  checkHoneypot,
  trackSignupBehavior,
  analyzeSignupBehavior,
  checkSuspiciousIP,
  verifySpotifyAccount,
  detectBot,
  logSuspiciousActivity,
  initializeBotProtection
};