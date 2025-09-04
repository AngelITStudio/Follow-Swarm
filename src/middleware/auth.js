/**
 * Authentication Middleware
 * 
 * Provides authentication and authorization middleware for API endpoints.
 * Handles JWT validation, session checks, and Spotify token verification.
 * Implements role-based access control and rate limiting.
 */

const jwt = require('jsonwebtoken');
const config = require('../../config');
const db = require('../database');
const logger = require('../utils/logger');
const spotifyAuth = require('../auth/spotify');

/**
 * Middleware to check if user is authenticated
 */
const isAuthenticated = async (req, res, next) => {
  try {
    // Debug logging for admin routes
    if (req.originalUrl?.includes('/admin') || req.path.includes('/admin')) {
      logger.info(`[AUTH DEBUG] Admin route check`);
      logger.info(`[AUTH DEBUG] URL: ${req.originalUrl || req.url}`);
      logger.info(`[AUTH DEBUG] Path: ${req.path}`);
      logger.info(`[AUTH DEBUG] Authorization header: ${req.headers.authorization ? `Present (${req.headers.authorization.substring(0, 20)}...)` : 'Missing'}`);
      logger.info(`[AUTH DEBUG] Session userId: ${req.session?.userId || 'None'}`);
    }
    
    // Check session
    if (req.session && req.session.userId) {
      // Get user from database
      const user = await db.findOne('users', { id: req.session.userId });
      
      if (user) {
        req.user = user;
        return next();
      }
    }
    
    // Check for JWT token in header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      
      try {
        const decoded = jwt.verify(token, config.security.jwtSecret);
        const user = await db.findOne('users', { id: decoded.userId });
        
        if (user) {
          req.user = user;
          logger.debug(`JWT auth successful for user: ${user.id} (${user.email})`);
          return next();
        }
      } catch (jwtError) {
        logger.debug('Invalid JWT token:', jwtError.message);
      }
    }
    
    // Not authenticated
    logger.debug(`Authentication failed for ${req.path} - no valid session or token`);
    return res.status(401).json({
      error: 'Authentication required',
      message: 'Please log in to access this resource'
    });
  } catch (error) {
    logger.error('Authentication middleware error:', error);
    return res.status(500).json({
      error: 'Authentication error',
      message: 'An error occurred during authentication'
    });
  }
};

/**
 * Middleware to check if user has valid Spotify tokens
 */
const hasValidSpotifyTokens = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'User not authenticated'
      });
    }
    
    // Try to get valid access token (will refresh if needed)
    try {
      const accessToken = await spotifyAuth.getValidAccessToken(req.user.id);
      req.spotifyAccessToken = accessToken;
      next();
    } catch (error) {
      logger.warn(`Invalid Spotify tokens for user ${req.user.id}:`, error.message);
      return res.status(401).json({
        error: 'Spotify authentication required',
        message: 'Please reconnect your Spotify account'
      });
    }
  } catch (error) {
    logger.error('Spotify token validation error:', error);
    return res.status(500).json({
      error: 'Token validation error',
      message: 'Failed to validate Spotify tokens'
    });
  }
};

/**
 * Middleware to check subscription tier
 */
const requireSubscription = (minimumTier = 'free') => {
  const tierOrder = { free: 0, pro: 1, premium: 2 };
  
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          error: 'Authentication required',
          message: 'User not authenticated'
        });
      }
      
      const userTier = req.user.subscription_tier || 'free';
      const userTierLevel = tierOrder[userTier] || 0;
      const requiredTierLevel = tierOrder[minimumTier] || 0;
      
      if (userTierLevel >= requiredTierLevel) {
        return next();
      }
      
      return res.status(403).json({
        error: 'Insufficient subscription',
        message: `This feature requires ${minimumTier} subscription or higher`,
        currentTier: userTier,
        requiredTier: minimumTier
      });
    } catch (error) {
      logger.error('Subscription check error:', error);
      return res.status(500).json({
        error: 'Subscription check error',
        message: 'Failed to verify subscription'
      });
    }
  };
};

/**
 * Middleware for rate limiting based on subscription
 */
const checkRateLimit = (action = 'api_call') => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return next();
      }
      
      const redis = require('../database/redis');
      const limits = {
        free: { hour: 100, day: 500 },
        pro: { hour: 500, day: 5000 },
        premium: { hour: -1, day: -1 } // Unlimited
      };
      
      const userTier = req.user.subscription_tier || 'free';
      const tierLimits = limits[userTier];
      
      // Check if unlimited
      if (tierLimits.hour === -1) {
        return next();
      }
      
      // Check hourly limit
      const hourlyCount = await redis.incrementRateLimit(req.user.id, action, 'hour');
      if (hourlyCount > tierLimits.hour) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          message: 'Hourly API limit reached',
          limit: tierLimits.hour,
          resetAt: new Date(Date.now() + 3600000).toISOString()
        });
      }
      
      // Check daily limit
      const dailyCount = await redis.incrementRateLimit(req.user.id, action, 'day');
      if (dailyCount > tierLimits.day) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          message: 'Daily API limit reached',
          limit: tierLimits.day,
          resetAt: new Date(Date.now() + 86400000).toISOString()
        });
      }
      
      // Add rate limit headers
      res.setHeader('X-RateLimit-Limit-Hour', tierLimits.hour);
      res.setHeader('X-RateLimit-Remaining-Hour', Math.max(0, tierLimits.hour - hourlyCount));
      res.setHeader('X-RateLimit-Limit-Day', tierLimits.day);
      res.setHeader('X-RateLimit-Remaining-Day', Math.max(0, tierLimits.day - dailyCount));
      
      next();
    } catch (error) {
      logger.error('Rate limit check error:', error);
      // Don't block request on error
      next();
    }
  };
};

/**
 * Generate JWT token for API access
 */
const generateApiToken = (userId) => {
  return jwt.sign(
    { userId, type: 'api' },
    config.security.jwtSecret,
    { expiresIn: '30d' }
  );
};

module.exports = {
  isAuthenticated,
  requireAuth: isAuthenticated, // Alias for backward compatibility
  hasValidSpotifyTokens,
  requireSubscription,
  checkSubscription: (tiers) => {
    // Middleware that checks if user has one of the specified tiers
    return async (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          error: 'Authentication required',
          message: 'User not authenticated'
        });
      }
      
      const userTier = req.user.subscription_tier || 'free';
      if (tiers.includes(userTier)) {
        return next();
      }
      
      return res.status(403).json({
        error: 'Insufficient subscription',
        message: `This feature requires one of: ${tiers.join(', ')}`,
        currentTier: userTier,
        requiredTiers: tiers
      });
    };
  },
  checkRateLimit,
  generateApiToken
};