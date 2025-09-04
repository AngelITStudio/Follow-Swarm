/**
 * Advanced Rate Limiting Middleware
 * 
 * Provides per-user and per-IP rate limiting with Redis backend
 * Supports different limits for different endpoints and user tiers
 * 
 * @author Claude
 * @since 2025-09-04
 */

const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const redis = require('../database/redis');
const logger = require('../utils/logger');

/**
 * Rate limit configurations per endpoint type
 */
const rateLimitConfigs = {
  // Authentication endpoints
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per window
    message: 'Too many authentication attempts, please try again later.'
  },
  
  // API endpoints for free tier
  apiFree: {
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute
    message: 'Rate limit exceeded. Please upgrade your plan for higher limits.'
  },
  
  // API endpoints for premium tier
  apiPremium: {
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute
    message: 'Rate limit exceeded. Please wait before making more requests.'
  },
  
  // Follow/unfollow actions
  followActions: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 30, // 30 follows per hour (Spotify's limit)
    message: 'Follow limit reached. Please wait before following more artists.'
  },
  
  // Admin endpoints
  admin: {
    windowMs: 60 * 1000, // 1 minute
    max: 200, // 200 requests per minute
    message: 'Admin rate limit exceeded.'
  },
  
  // 2FA verification
  twoFactorVerify: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 3, // 3 attempts per window
    message: 'Too many 2FA attempts. Please wait 15 minutes.'
  }
};

/**
 * Create a rate limiter (using memory store for now)
 */
function createRateLimiter(config, keyGenerator) {
  return rateLimit({
    // TODO: Fix Redis store compatibility
    // store: new RedisStore({
    //   client: redis.client,
    //   prefix: 'ratelimit:',
    // }),
    ...config,
    keyGenerator: keyGenerator || ((req) => {
      // Default: Use IP address or user ID if authenticated
      return req.user?.id || req.ip;
    }),
    standardHeaders: true, // Return rate limit info in headers
    legacyHeaders: false,
    handler: (req, res) => {
      logger.warn('Rate limit exceeded', {
        ip: req.ip,
        userId: req.user?.id,
        path: req.path
      });
      
      res.status(429).json({
        error: 'Too Many Requests',
        message: config.message,
        retryAfter: res.getHeader('Retry-After')
      });
    }
  });
}

/**
 * Per-user rate limiter (checks user subscription tier)
 */
const perUserRateLimiter = async (req, res, next) => {
  if (!req.user) {
    return next(); // Skip if not authenticated
  }
  
  const tier = req.user.subscription_tier || 'free';
  const config = tier === 'free' ? rateLimitConfigs.apiFree : rateLimitConfigs.apiPremium;
  
  const limiter = createRateLimiter(config, (req) => `user:${req.user.id}`);
  return limiter(req, res, next);
};

/**
 * Per-IP rate limiter
 */
const perIpRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute per IP
  message: 'Too many requests from this IP address.'
}, (req) => `ip:${req.ip}`);

/**
 * Auth rate limiter (strict for login/register)
 */
const authRateLimiter = createRateLimiter(
  rateLimitConfigs.auth,
  (req) => `auth:${req.ip}`
);

/**
 * Follow action rate limiter
 */
const followRateLimiter = createRateLimiter(
  rateLimitConfigs.followActions,
  (req) => `follow:${req.user?.id || req.ip}`
);

/**
 * 2FA verification rate limiter
 */
const twoFactorRateLimiter = createRateLimiter(
  rateLimitConfigs.twoFactorVerify,
  (req) => {
    // Use userId from body since user might not be fully authenticated yet
    const userId = req.body?.userId || req.ip;
    return `2fa:${userId}`;
  }
);

/**
 * Admin rate limiter
 */
const adminRateLimiter = createRateLimiter(
  rateLimitConfigs.admin,
  (req) => `admin:${req.user?.id || req.ip}`
);

/**
 * Combined rate limiter (applies both user and IP limits)
 */
const combinedRateLimiter = [perIpRateLimiter, perUserRateLimiter];

/**
 * Dynamic rate limiter based on endpoint
 */
function dynamicRateLimiter(type) {
  return (req, res, next) => {
    const config = rateLimitConfigs[type] || rateLimitConfigs.apiFree;
    const limiter = createRateLimiter(config);
    return limiter(req, res, next);
  };
}

/**
 * Track rate limit usage for monitoring
 */
async function getRateLimitStatus(userId, ip) {
  try {
    const userKey = `ratelimit:user:${userId}`;
    const ipKey = `ratelimit:ip:${ip}`;
    
    const [userCount, ipCount] = await Promise.all([
      redis.client.get(userKey),
      redis.client.get(ipKey)
    ]);
    
    return {
      user: {
        count: parseInt(userCount) || 0,
        limit: req.user?.subscription_tier === 'premium' ? 100 : 30
      },
      ip: {
        count: parseInt(ipCount) || 0,
        limit: 60
      }
    };
  } catch (error) {
    logger.error('Failed to get rate limit status:', error);
    return null;
  }
}

/**
 * Reset rate limits for a user (admin action)
 */
async function resetRateLimits(userId) {
  try {
    const keys = await redis.client.keys(`ratelimit:*${userId}*`);
    if (keys.length > 0) {
      await redis.client.del(...keys);
    }
    logger.info(`Reset rate limits for user ${userId}`);
    return true;
  } catch (error) {
    logger.error('Failed to reset rate limits:', error);
    return false;
  }
}

/**
 * Middleware to add rate limit info to response headers
 */
function addRateLimitHeaders(req, res, next) {
  res.on('finish', () => {
    // Log rate limit headers for monitoring
    const remaining = res.getHeader('X-RateLimit-Remaining');
    const limit = res.getHeader('X-RateLimit-Limit');
    
    if (remaining && limit) {
      const usage = ((limit - remaining) / limit) * 100;
      
      if (usage > 80) {
        logger.warn('High rate limit usage', {
          userId: req.user?.id,
          ip: req.ip,
          usage: `${usage.toFixed(1)}%`,
          remaining,
          limit
        });
      }
    }
  });
  
  next();
}

module.exports = {
  // Individual limiters
  authRateLimiter,
  perUserRateLimiter,
  perIpRateLimiter,
  followRateLimiter,
  twoFactorRateLimiter,
  adminRateLimiter,
  combinedRateLimiter,
  
  // Utilities
  dynamicRateLimiter,
  getRateLimitStatus,
  resetRateLimits,
  addRateLimitHeaders,
  
  // Configurations (for testing/customization)
  rateLimitConfigs
};