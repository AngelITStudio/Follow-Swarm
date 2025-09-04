/**
 * Two-Factor Authentication Routes
 * 
 * API endpoints for 2FA setup, verification, and management
 * Protected routes requiring authentication
 * 
 * @author Claude
 * @since 2025-09-04
 */

const express = require('express');
const router = express.Router();
const twoFactorAuth = require('../auth/twoFactorAuth');
const { isAuthenticated } = require('../middleware/auth');
const { validateCsrfToken } = require('../middleware/csrf');
const { twoFactorRateLimiter } = require('../middleware/rateLimiter');
const { mark2FAVerified } = require('../middleware/require2FA');
const logger = require('../utils/logger');

/**
 * @route GET /api/2fa/status
 * @desc Get 2FA status for current user
 * @access Private
 */
router.get('/status', isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await twoFactorAuth.getUserWith2FA(userId);
    
    const is2FARequired = await twoFactorAuth.is2FARequired(userId);
    
    res.json({
      enabled: user.two_fa_enabled,
      required: is2FARequired,
      enabledAt: user.two_fa_enabled_at,
      lastUsedAt: user.two_fa_last_used_at,
      backupCodesCount: user.two_fa_backup_codes ? user.two_fa_backup_codes.length : 0
    });
  } catch (error) {
    logger.error('Failed to get 2FA status:', error);
    res.status(500).json({ error: 'Failed to get 2FA status' });
  }
});

/**
 * @route POST /api/2fa/setup
 * @desc Generate 2FA secret and QR code for setup
 * @access Private
 */
router.post('/setup', isAuthenticated, validateCsrfToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Check if 2FA already enabled
    const user = await twoFactorAuth.getUserWith2FA(userId);
    if (user.two_fa_enabled) {
      return res.status(400).json({ error: '2FA already enabled' });
    }
    
    const setupData = await twoFactorAuth.generateSecret(userId);
    
    res.json({
      success: true,
      qrCode: setupData.qrCode,
      manualEntryKey: setupData.manualEntryKey
    });
  } catch (error) {
    logger.error('Failed to setup 2FA:', error);
    res.status(500).json({ error: 'Failed to setup 2FA' });
  }
});

/**
 * @route POST /api/2fa/verify-setup
 * @desc Verify token during 2FA setup
 * @access Private
 */
router.post('/verify-setup', isAuthenticated, validateCsrfToken, async (req, res) => {
  try {
    const { token } = req.body;
    const userId = req.user.userId;
    
    if (!token) {
      return res.status(400).json({ error: 'Token required' });
    }
    
    const verified = await twoFactorAuth.verifySetup(userId, token);
    
    if (verified) {
      const result = await twoFactorAuth.enable2FA(userId);
      
      res.json({
        success: true,
        backupCodes: result.backupCodes,
        message: '2FA has been enabled successfully'
      });
    } else {
      res.status(400).json({ 
        error: 'Invalid token', 
        message: 'Please try again with the code from your authenticator app' 
      });
    }
  } catch (error) {
    logger.error('Failed to verify 2FA setup:', error);
    res.status(500).json({ error: error.message || 'Failed to verify 2FA setup' });
  }
});

/**
 * @route POST /api/2fa/verify
 * @desc Verify 2FA token during login
 * @access Public (but requires partial auth)
 */
router.post('/verify', twoFactorRateLimiter, async (req, res) => {
  try {
    const { userId, token } = req.body;
    
    if (!userId || !token) {
      return res.status(400).json({ error: 'User ID and token required' });
    }
    
    const result = await twoFactorAuth.verifyToken(userId, token);
    
    if (result.success) {
      // Mark 2FA as verified in session
      mark2FAVerified(req);
      
      res.json({
        success: true,
        message: '2FA verification successful'
      });
    } else {
      res.status(401).json({
        error: 'Invalid 2FA token',
        message: 'Please check your authenticator app and try again'
      });
    }
  } catch (error) {
    logger.error('Failed to verify 2FA token:', error);
    res.status(500).json({ error: error.message || 'Failed to verify 2FA token' });
  }
});

/**
 * @route POST /api/2fa/verify-backup
 * @desc Verify backup code
 * @access Public (but requires partial auth)
 */
router.post('/verify-backup', twoFactorRateLimiter, async (req, res) => {
  try {
    const { userId, code } = req.body;
    
    if (!userId || !code) {
      return res.status(400).json({ error: 'User ID and backup code required' });
    }
    
    const result = await twoFactorAuth.verifyBackupCode(userId, code);
    
    if (result.success) {
      res.json({
        success: true,
        codesRemaining: result.codesRemaining,
        message: `Backup code verified. ${result.codesRemaining} codes remaining`,
        warning: result.codesRemaining < 3 ? 'You are running low on backup codes' : null
      });
    } else {
      res.status(401).json({
        error: 'Invalid backup code',
        message: 'Please check your backup code and try again'
      });
    }
  } catch (error) {
    logger.error('Failed to verify backup code:', error);
    res.status(500).json({ error: error.message || 'Failed to verify backup code' });
  }
});

/**
 * @route POST /api/2fa/regenerate-backup
 * @desc Regenerate backup codes
 * @access Private
 */
router.post('/regenerate-backup', isAuthenticated, validateCsrfToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Verify 2FA is enabled
    const user = await twoFactorAuth.getUserWith2FA(userId);
    if (!user.two_fa_enabled) {
      return res.status(400).json({ error: '2FA not enabled' });
    }
    
    // Generate new backup codes
    const backupCodes = twoFactorAuth.generateBackupCodes();
    const encryption = require('../utils/encryption');
    const encryptedBackupCodes = backupCodes.map(code => encryption.encrypt(code));
    
    // Update user's backup codes
    const db = require('../database');
    await db.query(
      'UPDATE users SET two_fa_backup_codes = $2 WHERE id = $1',
      [userId, encryptedBackupCodes]
    );
    
    logger.info(`Regenerated backup codes for user ${userId}`);
    
    res.json({
      success: true,
      backupCodes: backupCodes,
      message: 'New backup codes generated. Please save them securely.'
    });
  } catch (error) {
    logger.error('Failed to regenerate backup codes:', error);
    res.status(500).json({ error: 'Failed to regenerate backup codes' });
  }
});

/**
 * @route DELETE /api/2fa/disable
 * @desc Disable 2FA for current user
 * @access Private
 */
router.delete('/disable', isAuthenticated, validateCsrfToken, async (req, res) => {
  try {
    const { token } = req.body;
    const userId = req.user.userId;
    
    // Require 2FA token to disable (security measure)
    if (!token) {
      return res.status(400).json({ error: '2FA token required to disable' });
    }
    
    const verified = await twoFactorAuth.verifyToken(userId, token);
    if (!verified.success) {
      return res.status(401).json({ error: 'Invalid 2FA token' });
    }
    
    await twoFactorAuth.disable2FA(userId);
    
    res.json({
      success: true,
      message: '2FA has been disabled'
    });
  } catch (error) {
    logger.error('Failed to disable 2FA:', error);
    res.status(500).json({ error: 'Failed to disable 2FA' });
  }
});

module.exports = router;