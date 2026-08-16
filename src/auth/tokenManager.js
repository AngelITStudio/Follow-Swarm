/**
 * Token Manager Module
 * 
 * Handles token storage, retrieval, and validation
 * Split from spotify.js to maintain file size under 300 lines per SOP
 * 
 * @author Claude  
 * @since 2025-09-03
 */

const logger = require('../utils/logger');
const encryption = require('../utils/encryption');
const db = require('../database');
const redis = require('../database/redis');
const tokenRotation = require('./tokenRotation');

class TokenManager {
  /**
   * Save OAuth tokens to database (encrypted) with rotation support
   * @param {string} userId - User ID
   * @param {Object} tokens - Token data
   */
  async saveTokens(userId, tokens) {
    try {
      // Encrypt tokens before storage for security
      const encryptedAccessToken = encryption.encrypt(tokens.accessToken);
      const encryptedRefreshToken = encryption.encrypt(tokens.refreshToken);
      // Calculate token expiration time
      const expiresAt = new Date(Date.now() + (tokens.expiresIn * 1000));
      
      // Check if user already has tokens stored
      const existingTokens = await db.findOne('oauth_tokens', { user_id: userId });
      
      if (existingTokens) {
        // Use token rotation helper for rotation data
        const rotationData = tokenRotation.prepareRotationData(existingTokens, {
          encrypted_access_token: encryptedAccessToken,
          encrypted_refresh_token: encryptedRefreshToken,
          expires_at: expiresAt,
          scope: tokens.scope,
          access_token: encryptedAccessToken,
          refresh_token: encryptedRefreshToken
        });
        
        // Update existing token record with rotation support
        await db.update('oauth_tokens', existingTokens.id, rotationData);
      } else {
        // Create new token record
        await db.insert('oauth_tokens', {
          user_id: userId,
          encrypted_access_token: encryptedAccessToken,
          encrypted_refresh_token: encryptedRefreshToken,
          expires_at: expiresAt,
          scope: tokens.scope,
          token_version: 1,
          refresh_count: 0,
          access_token: encryptedAccessToken,
          refresh_token: encryptedRefreshToken
        });
      }
      
      // Cache unencrypted tokens in Redis for quick access
      // Redis data is encrypted at rest and in transit
      await redis.cacheToken(userId, {
        accessToken: tokens.accessToken,
        expiresAt: expiresAt.toISOString()
      }, tokens.expiresIn);
      
      logger.debug(`Saved tokens for user: ${userId}`);
    } catch (error) {
      logger.error('Failed to save tokens:', error);
      throw error;
    }
  }

  /**
   * Revoke user tokens (logout)
   * @param {string} userId - User ID
   */
  async revokeTokens(userId) {
    try {
      // Remove tokens from database
      const tokenRecord = await db.findOne('oauth_tokens', { user_id: userId });
      if (tokenRecord) {
        await db.delete('oauth_tokens', tokenRecord.id);
      }
      
      // Clear tokens from Redis cache
      await redis.invalidateToken(userId);
      
      logger.info(`Revoked tokens for user: ${userId}`);
    } catch (error) {
      logger.error('Failed to revoke tokens:', error);
      throw error;
    }
  }
}

module.exports = new TokenManager();
