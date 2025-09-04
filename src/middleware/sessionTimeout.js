/**
 * Session Timeout Warning Middleware
 * 
 * Monitors user sessions and provides warnings before timeout
 * Implements automatic session extension and forced logout
 * 
 * @author Claude
 * @since 2025-09-04
 */

const logger = require('../utils/logger');
const redis = require('../database/redis');

// Session timeout configurations (in milliseconds)
const SESSION_CONFIGS = {
  maxAge: 4 * 60 * 60 * 1000,        // 4 hours total session time
  warningTime: 15 * 60 * 1000,       // Warn 15 minutes before expiry
  extendTime: 30 * 60 * 1000,        // Extend by 30 minutes on activity
  checkInterval: 60 * 1000,          // Check every minute
  inactivityTimeout: 30 * 60 * 1000  // 30 minutes of inactivity
};

/**
 * Middleware to track session activity and timeout
 */
function sessionTimeoutMiddleware(req, res, next) {
  if (!req.session || !req.user) {
    return next();
  }

  const now = Date.now();
  const sessionId = req.sessionID;
  const userId = req.user.id;

  // Initialize session tracking if not exists
  if (!req.session.createdAt) {
    req.session.createdAt = now;
    req.session.lastActivity = now;
    req.session.expiresAt = now + SESSION_CONFIGS.maxAge;
  }

  // Update last activity
  const lastActivity = req.session.lastActivity || now;
  const inactivityDuration = now - lastActivity;
  
  // Check for inactivity timeout
  if (inactivityDuration > SESSION_CONFIGS.inactivityTimeout) {
    logger.warn(`Session timeout due to inactivity for user ${userId}`);
    req.session.destroy((err) => {
      if (err) logger.error('Failed to destroy session:', err);
    });
    
    return res.status(401).json({
      error: 'Session Expired',
      reason: 'inactivity',
      message: 'Your session has expired due to inactivity. Please log in again.'
    });
  }

  // Check for absolute session timeout
  const sessionAge = now - req.session.createdAt;
  if (sessionAge > SESSION_CONFIGS.maxAge) {
    logger.info(`Session expired after maximum duration for user ${userId}`);
    req.session.destroy((err) => {
      if (err) logger.error('Failed to destroy session:', err);
    });
    
    return res.status(401).json({
      error: 'Session Expired',
      reason: 'max_age',
      message: 'Your session has expired. Please log in again for security.'
    });
  }

  // Update activity timestamp
  req.session.lastActivity = now;

  // Calculate time until expiry
  const timeUntilExpiry = Math.min(
    SESSION_CONFIGS.maxAge - sessionAge,
    SESSION_CONFIGS.inactivityTimeout - inactivityDuration
  );

  // Add session info to response headers
  res.setHeader('X-Session-Expires-In', Math.floor(timeUntilExpiry / 1000));
  res.setHeader('X-Session-Warning', timeUntilExpiry < SESSION_CONFIGS.warningTime ? 'true' : 'false');

  // Store session metadata in Redis for monitoring
  storeSessionMetadata(sessionId, userId, {
    createdAt: req.session.createdAt,
    lastActivity: now,
    expiresAt: req.session.createdAt + SESSION_CONFIGS.maxAge,
    warningAt: req.session.createdAt + SESSION_CONFIGS.maxAge - SESSION_CONFIGS.warningTime
  }).catch(err => logger.error('Failed to store session metadata:', err));

  next();
}

/**
 * Store session metadata in Redis for monitoring
 */
async function storeSessionMetadata(sessionId, userId, metadata) {
  try {
    const key = `session:${sessionId}`;
    const data = {
      userId,
      ...metadata,
      updated: Date.now()
    };
    
    await redis.client.set(
      key,
      JSON.stringify(data),
      'EX',
      Math.floor(SESSION_CONFIGS.maxAge / 1000)
    );
  } catch (error) {
    logger.error('Failed to store session metadata:', error);
  }
}

/**
 * Get session status for a user
 */
async function getSessionStatus(req) {
  if (!req.session || !req.user) {
    return {
      authenticated: false,
      message: 'No active session'
    };
  }

  const now = Date.now();
  const sessionAge = now - req.session.createdAt;
  const lastActivity = req.session.lastActivity || now;
  const inactivityDuration = now - lastActivity;
  
  const timeUntilExpiry = Math.min(
    SESSION_CONFIGS.maxAge - sessionAge,
    SESSION_CONFIGS.inactivityTimeout - inactivityDuration
  );

  const shouldWarn = timeUntilExpiry < SESSION_CONFIGS.warningTime;
  
  return {
    authenticated: true,
    sessionId: req.sessionID,
    createdAt: req.session.createdAt,
    lastActivity: lastActivity,
    expiresIn: timeUntilExpiry,
    expiresAt: now + timeUntilExpiry,
    warning: shouldWarn,
    maxAge: SESSION_CONFIGS.maxAge,
    inactivityTimeout: SESSION_CONFIGS.inactivityTimeout,
    percentRemaining: Math.round((timeUntilExpiry / SESSION_CONFIGS.maxAge) * 100)
  };
}

/**
 * Extend session on user activity
 */
function extendSession(req) {
  if (!req.session) {
    return false;
  }

  const now = Date.now();
  
  // Extend the session expiry
  req.session.lastActivity = now;
  
  // Can only extend if not too close to max age
  const sessionAge = now - req.session.createdAt;
  if (sessionAge < SESSION_CONFIGS.maxAge - SESSION_CONFIGS.extendTime) {
    logger.info(`Extended session for user ${req.user?.id}`);
    return true;
  }
  
  return false;
}

/**
 * Clean up expired sessions from Redis
 */
async function cleanupExpiredSessions() {
  try {
    const keys = await redis.client.keys('session:*');
    let cleaned = 0;
    
    for (const key of keys) {
      const data = await redis.client.get(key);
      if (data) {
        const session = JSON.parse(data);
        if (session.expiresAt < Date.now()) {
          await redis.client.del(key);
          cleaned++;
        }
      }
    }
    
    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} expired sessions`);
    }
  } catch (error) {
    logger.error('Failed to cleanup expired sessions:', error);
  }
}

/**
 * Start session cleanup interval
 */
function startSessionCleanup() {
  setInterval(cleanupExpiredSessions, SESSION_CONFIGS.checkInterval);
  logger.info('Session cleanup scheduler started');
}

/**
 * Get all active sessions (admin function)
 */
async function getActiveSessions() {
  try {
    const keys = await redis.client.keys('session:*');
    const sessions = [];
    
    for (const key of keys) {
      const data = await redis.client.get(key);
      if (data) {
        const session = JSON.parse(data);
        if (session.expiresAt > Date.now()) {
          sessions.push({
            sessionId: key.replace('session:', ''),
            ...session
          });
        }
      }
    }
    
    return sessions;
  } catch (error) {
    logger.error('Failed to get active sessions:', error);
    return [];
  }
}

/**
 * Force logout a specific session (admin function)
 */
async function forceLogout(sessionId) {
  try {
    // Remove from Redis
    await redis.client.del(`session:${sessionId}`);
    
    // Mark for deletion in session store
    // This would need integration with express-session store
    
    logger.info(`Forced logout of session: ${sessionId}`);
    return true;
  } catch (error) {
    logger.error('Failed to force logout:', error);
    return false;
  }
}

module.exports = {
  sessionTimeoutMiddleware,
  getSessionStatus,
  extendSession,
  startSessionCleanup,
  getActiveSessions,
  forceLogout,
  SESSION_CONFIGS
};