/**
 * Session Management Routes
 * 
 * API endpoints for session status, timeout warnings, and management
 * 
 * @author Claude
 * @since 2025-09-04
 */

const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const {
  getSessionStatus,
  extendSession,
  getActiveSessions,
  forceLogout
} = require('../middleware/sessionTimeout');
const logger = require('../utils/logger');

/**
 * @route GET /api/session/status
 * @desc Get current session status and timeout info
 * @access Private
 */
router.get('/status', isAuthenticated, async (req, res) => {
  try {
    const status = await getSessionStatus(req);
    
    // Log warning if session is expiring soon
    if (status.warning) {
      logger.info(`Session expiring soon for user ${req.user.id}`, {
        expiresIn: status.expiresIn,
        percentRemaining: status.percentRemaining
      });
    }
    
    res.json({
      success: true,
      session: status
    });
  } catch (error) {
    logger.error('Failed to get session status:', error);
    res.status(500).json({
      error: 'Failed to get session status'
    });
  }
});

/**
 * @route POST /api/session/extend
 * @desc Extend current session timeout
 * @access Private
 */
router.post('/extend', isAuthenticated, async (req, res) => {
  try {
    const extended = extendSession(req);
    
    if (extended) {
      logger.info(`Session extended for user ${req.user.id}`);
      const sessionStatus = await getSessionStatus(req);
      res.json({
        success: true,
        message: 'Session extended successfully',
        session: sessionStatus
      });
    } else {
      res.status(400).json({
        error: 'Cannot extend session',
        message: 'Session is too close to maximum age limit'
      });
    }
  } catch (error) {
    logger.error('Failed to extend session:', error);
    res.status(500).json({
      error: 'Failed to extend session'
    });
  }
});

/**
 * @route POST /api/session/keepalive
 * @desc Keep session alive (called by frontend periodically)
 * @access Private
 */
router.post('/keepalive', isAuthenticated, async (req, res) => {
  try {
    // Simply accessing with sessionTimeoutMiddleware updates lastActivity
    const status = await getSessionStatus(req);
    
    res.json({
      success: true,
      session: {
        expiresIn: status.expiresIn,
        warning: status.warning
      }
    });
  } catch (error) {
    logger.error('Failed to process keepalive:', error);
    res.status(500).json({
      error: 'Failed to process keepalive'
    });
  }
});

/**
 * @route GET /api/session/settings
 * @desc Get session timeout settings
 * @access Private
 */
router.get('/settings', isAuthenticated, (req, res) => {
  const { SESSION_CONFIGS } = require('../middleware/sessionTimeout');
  
  res.json({
    success: true,
    settings: {
      maxSessionDuration: SESSION_CONFIGS.maxAge / 1000 / 60, // in minutes
      inactivityTimeout: SESSION_CONFIGS.inactivityTimeout / 1000 / 60, // in minutes
      warningTime: SESSION_CONFIGS.warningTime / 1000 / 60, // in minutes
      extendTime: SESSION_CONFIGS.extendTime / 1000 / 60 // in minutes
    }
  });
});

/**
 * @route GET /api/session/active
 * @desc Get all active sessions (admin only)
 * @access Admin
 */
router.get('/active', isAuthenticated, requireAdmin, async (req, res) => {
  try {
    const sessions = await getActiveSessions();
    
    // Group sessions by user
    const sessionsByUser = {};
    sessions.forEach(session => {
      if (!sessionsByUser[session.userId]) {
        sessionsByUser[session.userId] = [];
      }
      sessionsByUser[session.userId].push(session);
    });
    
    res.json({
      success: true,
      totalSessions: sessions.length,
      uniqueUsers: Object.keys(sessionsByUser).length,
      sessions: sessions,
      byUser: sessionsByUser
    });
  } catch (error) {
    logger.error('Failed to get active sessions:', error);
    res.status(500).json({
      error: 'Failed to get active sessions'
    });
  }
});

/**
 * @route DELETE /api/session/:sessionId
 * @desc Force logout a specific session (admin only)
 * @access Admin
 */
router.delete('/:sessionId', isAuthenticated, requireAdmin, async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const success = await forceLogout(sessionId);
    
    if (success) {
      logger.info(`Admin ${req.user.id} forced logout of session ${sessionId}`);
      res.json({
        success: true,
        message: 'Session terminated successfully'
      });
    } else {
      res.status(400).json({
        error: 'Failed to terminate session'
      });
    }
  } catch (error) {
    logger.error('Failed to force logout:', error);
    res.status(500).json({
      error: 'Failed to terminate session'
    });
  }
});

/**
 * @route POST /api/session/logout
 * @desc Logout current session
 * @access Private
 */
router.post('/logout', isAuthenticated, (req, res) => {
  try {
    const userId = req.user.id;
    const sessionId = req.sessionID;
    
    req.session.destroy((err) => {
      if (err) {
        logger.error('Failed to destroy session:', err);
        return res.status(500).json({
          error: 'Failed to logout'
        });
      }
      
      logger.info(`User ${userId} logged out, session ${sessionId} destroyed`);
      
      res.json({
        success: true,
        message: 'Logged out successfully'
      });
    });
  } catch (error) {
    logger.error('Failed to logout:', error);
    res.status(500).json({
      error: 'Failed to logout'
    });
  }
});

module.exports = router;
