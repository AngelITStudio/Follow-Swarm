/**
 * Two-Factor Authentication Service
 * 
 * Handles 2FA setup, verification, and management for admin accounts
 * Uses speakeasy for TOTP generation and QR codes for easy setup
 * 
 * @author Claude
 * @since 2025-09-04
 */

const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const crypto = require('crypto');
const db = require('../database');
const encryption = require('../utils/encryption');
const logger = require('../utils/logger');

class TwoFactorAuthService {
  constructor() {
    this.appName = 'Follow Swarm';
    this.backupCodeCount = 10;
    this.backupCodeLength = 8;
  }

  /**
   * Generate a new 2FA secret for user setup
   */
  async generateSecret(userId) {
    try {
      const user = await this.getUserById(userId);
      
      // Generate secret
      const secret = speakeasy.generateSecret({
        name: `${this.appName} (${user.email})`,
        length: 32
      });

      // Generate QR code
      const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

      // Store temporary setup token
      const encryptedSecret = encryption.encrypt(secret.base32);
      
      await db.query(
        `INSERT INTO two_fa_setup_tokens (user_id, secret, qr_code, expires_at)
         VALUES ($1, $2, $3, NOW() + INTERVAL '10 minutes')
         ON CONFLICT (user_id) DO UPDATE
         SET secret = $2, qr_code = $3, expires_at = NOW() + INTERVAL '10 minutes', verified = FALSE`,
        [userId, encryptedSecret, qrCodeUrl]
      );

      return {
        secret: secret.base32,
        qrCode: qrCodeUrl,
        manualEntryKey: secret.base32.match(/.{1,4}/g).join(' ') // Format for manual entry
      };
    } catch (error) {
      logger.error('Failed to generate 2FA secret:', error);
      throw new Error('Failed to generate 2FA secret');
    }
  }

  /**
   * Verify 2FA token during setup
   */
  async verifySetup(userId, token) {
    try {
      // Get setup token
      const result = await db.query(
        `SELECT secret FROM two_fa_setup_tokens 
         WHERE user_id = $1 AND expires_at > NOW() AND verified = FALSE`,
        [userId]
      );

      if (result.rows.length === 0) {
        throw new Error('Setup token expired or not found');
      }

      const decryptedSecret = encryption.decrypt(result.rows[0].secret);
      
      // Verify token
      const verified = speakeasy.totp.verify({
        secret: decryptedSecret,
        encoding: 'base32',
        token: token,
        window: 1
      });

      if (verified) {
        // Mark setup token as verified
        await db.query(
          'UPDATE two_fa_setup_tokens SET verified = TRUE WHERE user_id = $1',
          [userId]
        );
        
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Failed to verify 2FA setup:', error);
      throw error;
    }
  }

  /**
   * Enable 2FA for user after successful verification
   */
  async enable2FA(userId) {
    try {
      // Get verified setup token
      const setupResult = await db.query(
        `SELECT secret FROM two_fa_setup_tokens 
         WHERE user_id = $1 AND verified = TRUE`,
        [userId]
      );

      if (setupResult.rows.length === 0) {
        throw new Error('2FA setup not verified');
      }

      // Generate backup codes
      const backupCodes = this.generateBackupCodes();
      const encryptedBackupCodes = backupCodes.map(code => encryption.encrypt(code));

      // Enable 2FA for user
      await db.query(
        `UPDATE users 
         SET two_fa_enabled = TRUE,
             two_fa_secret = $2,
             two_fa_backup_codes = $3,
             two_fa_enabled_at = NOW()
         WHERE id = $1`,
        [userId, setupResult.rows[0].secret, encryptedBackupCodes]
      );

      // Clean up setup token
      await db.query('DELETE FROM two_fa_setup_tokens WHERE user_id = $1', [userId]);

      logger.info(`2FA enabled for user ${userId}`);

      return {
        success: true,
        backupCodes: backupCodes
      };
    } catch (error) {
      logger.error('Failed to enable 2FA:', error);
      throw error;
    }
  }

  /**
   * Verify 2FA token during login
   */
  async verifyToken(userId, token) {
    try {
      const user = await this.getUserWith2FA(userId);
      
      if (!user.two_fa_enabled) {
        return { success: true, requires2FA: false };
      }

      // Check if account is locked
      const lockoutCheck = await this.checkLockout(userId);
      if (lockoutCheck.locked) {
        throw new Error(`Account locked. Try again in ${lockoutCheck.remainingMinutes} minutes`);
      }

      const decryptedSecret = encryption.decrypt(user.two_fa_secret);
      
      // Verify TOTP token
      const verified = speakeasy.totp.verify({
        secret: decryptedSecret,
        encoding: 'base32',
        token: token,
        window: 1 // Allow 1 window before/after for clock skew
      });

      // Record attempt
      await this.record2FAAttempt(userId, verified);

      if (verified) {
        // Update last used timestamp
        await db.query(
          'UPDATE users SET two_fa_last_used_at = NOW() WHERE id = $1',
          [userId]
        );
        
        return { success: true };
      }

      return { success: false };
    } catch (error) {
      logger.error('Failed to verify 2FA token:', error);
      throw error;
    }
  }

  /**
   * Verify backup code
   */
  async verifyBackupCode(userId, code) {
    try {
      const user = await this.getUserWith2FA(userId);
      
      if (!user.two_fa_enabled || !user.two_fa_backup_codes) {
        return { success: false };
      }

      // Find and verify backup code
      let codeFound = false;
      const remainingCodes = [];
      
      for (const encryptedCode of user.two_fa_backup_codes) {
        const decryptedCode = encryption.decrypt(encryptedCode);
        if (decryptedCode === code && !codeFound) {
          codeFound = true;
          // Don't add used code to remaining codes
        } else {
          remainingCodes.push(encryptedCode);
        }
      }

      if (codeFound) {
        // Update backup codes (remove used one)
        await db.query(
          'UPDATE users SET two_fa_backup_codes = $2 WHERE id = $1',
          [userId, remainingCodes]
        );

        // Record successful attempt
        await this.record2FAAttempt(userId, true, 'backup_code');

        logger.info(`Backup code used for user ${userId}. ${remainingCodes.length} codes remaining`);
        
        return { 
          success: true, 
          codesRemaining: remainingCodes.length 
        };
      }

      // Record failed attempt
      await this.record2FAAttempt(userId, false, 'invalid_backup_code');
      
      return { success: false };
    } catch (error) {
      logger.error('Failed to verify backup code:', error);
      throw error;
    }
  }

  /**
   * Disable 2FA for user
   */
  async disable2FA(userId) {
    try {
      await db.query(
        `UPDATE users 
         SET two_fa_enabled = FALSE,
             two_fa_secret = NULL,
             two_fa_backup_codes = NULL,
             two_fa_enabled_at = NULL
         WHERE id = $1`,
        [userId]
      );

      logger.info(`2FA disabled for user ${userId}`);
      return true;
    } catch (error) {
      logger.error('Failed to disable 2FA:', error);
      throw error;
    }
  }

  /**
   * Generate backup codes
   */
  generateBackupCodes() {
    const codes = [];
    for (let i = 0; i < this.backupCodeCount; i++) {
      codes.push(
        crypto.randomBytes(this.backupCodeLength)
          .toString('hex')
          .slice(0, this.backupCodeLength)
          .toUpperCase()
      );
    }
    return codes;
  }

  /**
   * Check if user is locked out from too many failed attempts
   */
  async checkLockout(userId) {
    const maxAttempts = 3; // From system_settings
    const lockoutDuration = 15; // minutes

    const result = await db.query(
      `SELECT COUNT(*) as failed_attempts
       FROM two_fa_attempts
       WHERE user_id = $1 
       AND success = FALSE
       AND attempted_at > NOW() - INTERVAL '${lockoutDuration} minutes'`,
      [userId]
    );

    const failedAttempts = parseInt(result.rows[0].failed_attempts);
    
    if (failedAttempts >= maxAttempts) {
      const oldestAttempt = await db.query(
        `SELECT attempted_at
         FROM two_fa_attempts
         WHERE user_id = $1 
         AND success = FALSE
         AND attempted_at > NOW() - INTERVAL '${lockoutDuration} minutes'
         ORDER BY attempted_at ASC
         LIMIT 1`,
        [userId]
      );

      const lockoutEnds = new Date(oldestAttempt.rows[0].attempted_at);
      lockoutEnds.setMinutes(lockoutEnds.getMinutes() + lockoutDuration);
      const remainingMinutes = Math.ceil((lockoutEnds - new Date()) / 60000);

      return {
        locked: true,
        remainingMinutes
      };
    }

    return { locked: false };
  }

  /**
   * Record 2FA attempt for audit
   */
  async record2FAAttempt(userId, success, errorMessage = null) {
    try {
      await db.query(
        `INSERT INTO two_fa_attempts (user_id, success, error_message, attempted_at)
         VALUES ($1, $2, $3, NOW())`,
        [userId, success, errorMessage]
      );
    } catch (error) {
      logger.error('Failed to record 2FA attempt:', error);
    }
  }

  /**
   * Helper to get user by ID
   */
  async getUserById(userId) {
    const result = await db.query(
      'SELECT id, email, role FROM users WHERE id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      throw new Error('User not found');
    }
    
    return result.rows[0];
  }

  /**
   * Helper to get user with 2FA data
   */
  async getUserWith2FA(userId) {
    const result = await db.query(
      `SELECT id, email, role, two_fa_enabled, two_fa_secret, two_fa_backup_codes
       FROM users WHERE id = $1`,
      [userId]
    );
    
    if (result.rows.length === 0) {
      throw new Error('User not found');
    }
    
    return result.rows[0];
  }

  /**
   * Check if 2FA is required for user
   */
  async is2FARequired(userId) {
    const user = await this.getUserWith2FA(userId);
    
    // Check if admin and 2FA is required for admins
    if (user.role === 'admin') {
      const settingResult = await db.query(
        "SELECT value FROM system_settings WHERE key = '2fa_required_for_admins'",
        []
      );
      
      if (settingResult.rows.length > 0 && settingResult.rows[0].value === 'true') {
        return true;
      }
    }
    
    return user.two_fa_enabled;
  }
}

module.exports = new TwoFactorAuthService();