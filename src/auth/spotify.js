/**
 * Spotify Authentication Module
 * 
 * Handles all Spotify OAuth 2.0 authentication flows and token management.
 * Provides methods for user authentication, token refresh, and secure token storage.
 * Integrates with Spotify Web API for user profile and follow operations.
 */

const SpotifyWebApi = require('spotify-web-api-node');
const config = require('../../config');
const logger = require('../utils/logger');
const encryption = require('../utils/encryption');
const db = require('../database');
const redis = require('../database/redis');
const tokenRotation = require('./tokenRotation');
const tokenManager = require('./tokenManager');

/**
 * SpotifyAuth Class
 * 
 * Manages Spotify OAuth flow, token lifecycle, and user profile operations.
 * All tokens are encrypted before storage and cached for performance.
 */
class SpotifyAuth {
  constructor() {
    // Initialize Spotify Web API client with OAuth credentials
    this.spotifyApi = new SpotifyWebApi({
      clientId: config.spotify.clientId,
      clientSecret: config.spotify.clientSecret,
      redirectUri: config.spotify.redirectUri
    });
  }

  /**
   * Generate authorization URL for OAuth flow
   * @param {string} state - State parameter for CSRF protection
   * @param {string[]} additionalScopes - Additional scopes to request
   * @returns {string} Authorization URL
   */
  getAuthorizationUrl(state, additionalScopes = []) {
    // Use scope validation to get proper scopes
    const { getAllRequiredScopes } = require('../middleware/scopeValidation');
    const scopes = [...getAllRequiredScopes(), ...additionalScopes];
    
    logger.info(`Creating auth URL with redirect URI: ${config.spotify.redirectUri}`);
    logger.info(`Requesting scopes: ${scopes.join(', ')}`);
    return this.spotifyApi.createAuthorizeURL(scopes, state);
  }

  /**
   * Exchange authorization code for access tokens
   * @param {string} code - Authorization code from Spotify
   * @returns {Object} Token data
   */
  async exchangeCodeForTokens(code) {
    try {
      const data = await this.spotifyApi.authorizationCodeGrant(code);
      
      return {
        accessToken: data.body['access_token'],
        refreshToken: data.body['refresh_token'],
        expiresIn: data.body['expires_in'],
        scope: data.body['scope']
      };
    } catch (error) {
      logger.error('Failed to exchange code for tokens:', error);
      throw new Error('Failed to authenticate with Spotify');
    }
  }

  /**
   * Refresh access token using refresh token with rotation support
   * Implements token rotation for enhanced security - Spotify may return new refresh tokens
   * @param {string} refreshToken - Refresh token
   * @param {string} userId - User ID for rotation tracking
   * @returns {Object} New token data with rotated refresh token if applicable
   * @since 2025-09-03 - Added rotation support for continuous authentication
   */
  async refreshAccessToken(refreshToken, userId = null) {
    try {
      this.spotifyApi.setRefreshToken(refreshToken);
      const data = await this.spotifyApi.refreshAccessToken();
      
      const result = {
        accessToken: data.body['access_token'],
        expiresIn: data.body['expires_in'],
        refreshToken: data.body['refresh_token'] || refreshToken // Spotify may return new refresh token
      };
      
      // Track refresh if userId provided (for rotation tracking)
      if (userId && data.body['refresh_token']) {
        logger.info(`Refresh token rotated for user: ${userId}`);
        await tokenRotation.trackTokenRefresh(userId, 'rotation');
      }
      
      return result;
    } catch (error) {
      logger.error('Failed to refresh access token:', error);
      throw new Error('Failed to refresh authentication');
    }
  }

  /**
   * Get user profile from Spotify
   * @param {string} accessToken - Access token
   * @returns {Object} User profile data
   */
  async getUserProfile(accessToken) {
    try {
      this.spotifyApi.setAccessToken(accessToken);
      const data = await this.spotifyApi.getMe();
      
      return {
        spotifyId: data.body.id,
        email: data.body.email,
        displayName: data.body.display_name,
        profileImageUrl: data.body.images?.[0]?.url || null,
        country: data.body.country,
        product: data.body.product,
        followers: data.body.followers?.total || 0
      };
    } catch (error) {
      logger.error('Failed to get user profile:', error);
      throw new Error('Failed to fetch user profile');
    }
  }

  /**
   * Save or update user in database
   * @param {Object} profile - User profile from Spotify
   * @returns {Object} User record
   */
  async saveOrUpdateUser(profile) {
    try {
      // Check if user already exists in database
      const existingUser = await db.findOne('users', { spotify_id: profile.spotifyId });
      
      if (existingUser) {
        // Update existing user's profile information
        const updatedUser = await db.update('users', existingUser.id, {
          email: profile.email,
          display_name: profile.displayName,
          profile_image_url: profile.profileImageUrl,
          country: profile.country,
          product: profile.product
        });
        
        logger.info(`Updated user: ${profile.spotifyId}`);
        return updatedUser;
      } else {
        // Create new user account
        const newUser = await db.insert('users', {
          spotify_id: profile.spotifyId,
          email: profile.email,
          display_name: profile.displayName,
          profile_image_url: profile.profileImageUrl,
          country: profile.country,
          product: profile.product,
          subscription_tier: 'free' // New users start with free tier
        });
        
        logger.info(`Created new user: ${profile.spotifyId}`);
        
        // Track signup event for analytics
        await db.insert('analytics', {
          user_id: newUser.id,
          event_type: 'signup',
          event_category: 'user',
          event_data: { source: 'spotify_oauth' }
        });
        
        return newUser;
      }
    } catch (error) {
      logger.error('Failed to save/update user:', error);
      throw error;
    }
  }

  /**
   * Save OAuth tokens to database (encrypted) with rotation support
   * Delegates to tokenManager module
   * @param {string} userId - User ID
   * @param {Object} tokens - Token data
   */
  async saveTokens(userId, tokens) {
    return tokenManager.saveTokens(userId, tokens);
  }

  /**
   * Get valid access token for user (refresh if needed)
   * @param {string} userId - User ID
   * @returns {string} Valid access token
   */
  async getValidAccessToken(userId) {
    try {
      // Check Redis cache first for performance
      const cachedToken = await redis.getCachedToken(userId);
      if (cachedToken && new Date(cachedToken.expiresAt) > new Date()) {
        return cachedToken.accessToken;
      }
      
      // Fallback to database if not in cache
      const tokenRecord = await db.findOne('oauth_tokens', { user_id: userId });
      if (!tokenRecord) {
        throw new Error('No tokens found for user');
      }
      
      // Check if token is still valid
      if (new Date(tokenRecord.expires_at) > new Date(Date.now() + 60000)) {
        // Token is valid (with 1 minute buffer for safety)
        const decryptedToken = encryption.decrypt(tokenRecord.encrypted_access_token);
        
        // Re-cache the valid token
        await redis.cacheToken(userId, {
          accessToken: decryptedToken,
          expiresAt: tokenRecord.expires_at
        });
        
        return decryptedToken;
      }
      
      // Token expired, use refresh token to get new access token with rotation
      const decryptedRefreshToken = encryption.decrypt(tokenRecord.encrypted_refresh_token);
      const newTokens = await this.refreshAccessToken(decryptedRefreshToken, userId);
      
      // Save new tokens (including rotated refresh token if provided)
      await this.saveTokens(userId, {
        accessToken: newTokens.accessToken,
        refreshToken: newTokens.refreshToken, // May be rotated
        expiresIn: newTokens.expiresIn,
        scope: tokenRecord.scope
      });
      
      return newTokens.accessToken;
    } catch (error) {
      logger.error('Failed to get valid access token:', error);
      throw error;
    }
  }

  /**
   * Revoke user tokens (logout)
   * Delegates to tokenManager module
   * @param {string} userId - User ID
   */
  async revokeTokens(userId) {
    return tokenManager.revokeTokens(userId);
  }
  
  /**
   * Proactively refresh tokens that are about to expire
   * Delegates to tokenRotation module for implementation
   * @param {number} bufferMinutes - Minutes before expiry to trigger refresh (default: 5)
   * @returns {Array} Array of refreshed user IDs
   */
  async refreshExpiringTokens(bufferMinutes = 5) {
    return tokenRotation.refreshExpiringTokens(
      this.getValidAccessToken.bind(this),
      bufferMinutes
    );
  }
}

// Export singleton instance for consistent Spotify API access
module.exports = new SpotifyAuth();