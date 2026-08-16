/**
 * Token Rotation Module
 * 
 * Handles refresh token rotation and proactive token refresh
 * Split from spotify.js to maintain file size under 300 lines per SOP
 * 
 * @author Claude
 * @since 2025-09-03
 */

const logger = require('../utils/logger');
const db = require('../database');

class TokenRotation {
  /**
   * Track token refresh for audit trail
   * @param {string} userId - User ID
   * @param {string} reason - Reason for refresh (manual, expiry, rotation, security)
   */
  async trackTokenRefresh(userId, reason) {
    try {
      await db.insert('token_refresh_history', {
        user_id: userId,
        refresh_reason: reason,
        refreshed_at: new Date()
      });
    } catch (error) {
      logger.error('Failed to track token refresh:', error);
      // Non-critical, don't throw
    }
  }
  
  /**
   * Proactively refresh tokens that are about to expire
   * @param {Function} getValidAccessToken - Token refresh function from SpotifyAuth
   * @param {number} bufferMinutes - Minutes before expiry to trigger refresh (default: 5)
   * @returns {Array} Array of refreshed user IDs
   */
  async refreshExpiringTokens(getValidAccessToken, bufferMinutes = 5) {
    try {
      const expiryThreshold = new Date(Date.now() + (bufferMinutes * 60 * 1000));
      
      // Find tokens expiring within buffer period
      const expiringTokens = await db.query(
        `SELECT * FROM oauth_tokens 
         WHERE expires_at <= $1 
         AND expires_at > NOW()`,
        [expiryThreshold]
      );
      
      const refreshedUsers = [];
      
      for (const tokenRecord of expiringTokens.rows) {
        try {
          logger.info(`Proactively refreshing token for user: ${tokenRecord.user_id}`);
          
          // Use provided refresh function
          await getValidAccessToken(tokenRecord.user_id);
          refreshedUsers.push(tokenRecord.user_id);
          
          await this.trackTokenRefresh(tokenRecord.user_id, 'expiry');
        } catch (error) {
          logger.error(`Failed to refresh token for user ${tokenRecord.user_id}:`, error);
        }
      }
      
      logger.info(`Proactively refreshed ${refreshedUsers.length} tokens`);
      return refreshedUsers;
    } catch (error) {
      logger.error('Failed to refresh expiring tokens:', error);
      return [];
    }
  }

  /**
   * Update token record with rotation data
   * @param {Object} existingTokens - Current token record
   * @param {Object} newTokenData - New token data to save
   * @returns {Object} Updated token data with rotation fields
   */
  prepareRotationData(existingTokens, newTokenData) {
    return {
      ...newTokenData,
      token_version: (existingTokens.token_version || 0) + 1,
      last_refreshed_at: new Date(),
      refresh_count: (existingTokens.refresh_count || 0) + 1,
      previous_refresh_token: existingTokens.encrypted_refresh_token
    };
  }
}

module.exports = new TokenRotation();
