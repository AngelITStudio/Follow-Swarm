/**
 * 2FA Requirement Middleware
 * 
 * Enforces two-factor authentication for protected routes
 * Checks if user has 2FA enabled and if they've verified recently
 * 
 * @author Claude
 * @since 2025-09-04
 */

const twoFactorAuth = require('../auth/twoFactorAuth');
const logger = require('../utils/logger');

/**
 * Middleware to require 2FA verification for sensitive operations
 * 
 * @param {boolean} strict - If true, blocks access without 2FA. If false, logs warning.
 */
function require2FA(strict = true) {
  return async (req, res, next) => {
    try {
      // Check if user is authenticated
      if (!req.user || !req.user.id) {
        return res.status(401).json({
          error: 'Authentication required',
          message: 'Please log in to access this resource'
        });
      }

      const userId = req.user.id;
      
      // Check if 2FA is required for this user
      const requires2FA = await twoFactorAuth.is2FARequired(userId);
      
      if (!requires2FA) {
        // User doesn't require 2FA, allow access
        return next();
      }

      // Get user's 2FA status
      const user = await twoFactorAuth.getUserWith2FA(userId);
      
      if (!user.two_fa_enabled) {
        // 2FA required but not set up
        logger.warn(`User ${userId} accessing protected route without 2FA setup`);
        
        if (strict) {
          return res.status(403).json({
            error: '2FA Required',
            message: 'Two-factor authentication must be enabled to access this resource',
            action: 'setup_2fa',
            setupUrl: '/api/2fa/setup'
          });
        } else {
          // Log warning but allow access (grace period)
          logger.warn(`Allowing access during 2FA grace period for user ${userId}`);
          req.requires2FA = true; // Flag for the route handler
          return next();
        }
      }

      // Check if user has verified 2FA recently (within session)
      // TODO: Implement session-based 2FA verification tracking
      const verified2FA = req.session?.verified2FA;
      const verifiedAt = req.session?.verified2FAAt;
      
      if (verified2FA && verifiedAt) {
        // Check if verification is still valid (e.g., within last 4 hours)
        const verificationAge = Date.now() - new Date(verifiedAt).getTime();
        const maxAge = 4 * 60 * 60 * 1000; // 4 hours
        
        if (verificationAge < maxAge) {
          // Recent verification, allow access
          return next();
        }
      }

      // Require fresh 2FA verification
      if (strict) {
        return res.status(403).json({
          error: '2FA Verification Required',
          message: 'Please verify your identity with two-factor authentication',
          action: 'verify_2fa',
          verifyUrl: '/api/2fa/verify'
        });
      } else {
        logger.warn(`2FA verification expired for user ${userId}, allowing with warning`);
        req.needs2FARefresh = true;
        return next();
      }

    } catch (error) {
      logger.error('Error in require2FA middleware:', error);
      
      // On error, fail securely
      if (strict) {
        return res.status(500).json({
          error: 'Security Check Failed',
          message: 'Unable to verify security requirements'
        });
      } else {
        // Allow access but log the error
        logger.error(`2FA check failed for user ${req.user?.id}, allowing access`);
        return next();
      }
    }
  };
}

/**
 * Strict 2FA requirement (blocks access without 2FA)
 */
const requireStrict2FA = require2FA(true);

/**
 * Soft 2FA requirement (logs warning but allows access)
 */
const requireSoft2FA = require2FA(false);

/**
 * Mark 2FA as verified in session after successful verification
 */
function mark2FAVerified(req) {
  if (req.session) {
    req.session.verified2FA = true;
    req.session.verified2FAAt = new Date().toISOString();
    logger.info(`Marked 2FA as verified for user ${req.user?.id}`);
  }
}

/**
 * Clear 2FA verification from session (on logout or timeout)
 */
function clear2FAVerification(req) {
  if (req.session) {
    delete req.session.verified2FA;
    delete req.session.verified2FAAt;
    logger.info(`Cleared 2FA verification for user ${req.user?.id}`);
  }
}

module.exports = {
  require2FA,
  requireStrict2FA,
  requireSoft2FA,
  mark2FAVerified,
  clear2FAVerification
};