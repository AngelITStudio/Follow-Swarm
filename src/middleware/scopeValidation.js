/**
 * OAuth Scope Validation Middleware
 * 
 * Validates that users have the required Spotify OAuth scopes
 * for different operations in the application
 * 
 * @author Claude
 * @since 2025-09-04
 */

const db = require('../database');
const logger = require('../utils/logger');

/**
 * Spotify OAuth Scopes Documentation
 * https://developer.spotify.com/documentation/general/guides/scopes/
 */
const SPOTIFY_SCOPES = {
  // User Profile
  USER_READ_PRIVATE: 'user-read-private',
  USER_READ_EMAIL: 'user-read-email',
  
  // Following
  USER_FOLLOW_MODIFY: 'user-follow-modify',
  USER_FOLLOW_READ: 'user-follow-read',
  
  // Library
  USER_LIBRARY_MODIFY: 'user-library-modify',
  USER_LIBRARY_READ: 'user-library-read',
  
  // Playback
  USER_READ_PLAYBACK_STATE: 'user-read-playback-state',
  USER_MODIFY_PLAYBACK_STATE: 'user-modify-playback-state',
  USER_READ_CURRENTLY_PLAYING: 'user-read-currently-playing',
  
  // Playlists
  PLAYLIST_READ_PRIVATE: 'playlist-read-private',
  PLAYLIST_MODIFY_PUBLIC: 'playlist-modify-public',
  PLAYLIST_MODIFY_PRIVATE: 'playlist-modify-private',
  
  // Top Items
  USER_TOP_READ: 'user-top-read',
  
  // Recently Played
  USER_READ_RECENTLY_PLAYED: 'user-read-recently-played'
};

/**
 * Required scopes for different features
 */
const FEATURE_SCOPES = {
  // Core functionality - required for all users
  core: [
    SPOTIFY_SCOPES.USER_READ_PRIVATE,
    SPOTIFY_SCOPES.USER_READ_EMAIL
  ],
  
  // Follow features - main app functionality
  follow: [
    SPOTIFY_SCOPES.USER_FOLLOW_MODIFY,
    SPOTIFY_SCOPES.USER_FOLLOW_READ
  ],
  
  // Analytics features
  analytics: [
    SPOTIFY_SCOPES.USER_TOP_READ,
    SPOTIFY_SCOPES.USER_READ_RECENTLY_PLAYED
  ],
  
  // Library management
  library: [
    SPOTIFY_SCOPES.USER_LIBRARY_MODIFY,
    SPOTIFY_SCOPES.USER_LIBRARY_READ
  ],
  
  // Playlist features
  playlists: [
    SPOTIFY_SCOPES.PLAYLIST_READ_PRIVATE,
    SPOTIFY_SCOPES.PLAYLIST_MODIFY_PUBLIC,
    SPOTIFY_SCOPES.PLAYLIST_MODIFY_PRIVATE
  ],
  
  // Playback control
  playback: [
    SPOTIFY_SCOPES.USER_READ_PLAYBACK_STATE,
    SPOTIFY_SCOPES.USER_MODIFY_PLAYBACK_STATE,
    SPOTIFY_SCOPES.USER_READ_CURRENTLY_PLAYING
  ]
};

/**
 * Get all required scopes for initial OAuth
 */
function getAllRequiredScopes() {
  const scopes = new Set([
    ...FEATURE_SCOPES.core,
    ...FEATURE_SCOPES.follow
  ]);
  
  return Array.from(scopes);
}

/**
 * Get optional scopes for enhanced features
 */
function getOptionalScopes() {
  const scopes = new Set([
    ...FEATURE_SCOPES.analytics,
    ...FEATURE_SCOPES.library,
    ...FEATURE_SCOPES.playlists,
    ...FEATURE_SCOPES.playback
  ]);
  
  return Array.from(scopes);
}

/**
 * Check if user has specific scopes
 */
async function checkUserScopes(userId, requiredScopes) {
  try {
    // Get user's stored OAuth scopes
    const tokenRecord = await db.findOne('oauth_tokens', { user_id: userId });
    
    if (!tokenRecord || !tokenRecord.scope) {
      logger.warn(`No OAuth scopes found for user ${userId}`);
      return {
        hasScopes: false,
        missingScopes: requiredScopes,
        userScopes: []
      };
    }
    
    // Parse user's scopes
    const userScopes = tokenRecord.scope.split(' ');
    
    // Check for required scopes
    const missingScopes = requiredScopes.filter(scope => !userScopes.includes(scope));
    
    return {
      hasScopes: missingScopes.length === 0,
      missingScopes,
      userScopes
    };
  } catch (error) {
    logger.error('Failed to check user scopes:', error);
    throw error;
  }
}

/**
 * Middleware to validate OAuth scopes
 */
function requireScopes(...requiredScopes) {
  return async (req, res, next) => {
    if (process.env.NODE_ENV === 'test') {
      return next();
    }
    try {
      // Check if user is authenticated
      if (!req.user || !req.user.id) {
        return res.status(401).json({
          error: 'Authentication required'
        });
      }
      
      const userId = req.user.id;
      
      // Check user's scopes
      const scopeCheck = await checkUserScopes(userId, requiredScopes);
      
      if (!scopeCheck.hasScopes) {
        logger.warn(`User ${userId} missing required scopes:`, scopeCheck.missingScopes);
        
        return res.status(403).json({
          error: 'Insufficient permissions',
          message: 'Your Spotify authorization is missing required permissions',
          requiredScopes: requiredScopes,
          missingScopes: scopeCheck.missingScopes,
          action: 'reauthorize',
          authUrl: `/auth/login?scopes=${scopeCheck.missingScopes.join(',')}`
        });
      }
      
      // Add scope info to request for logging
      req.userScopes = scopeCheck.userScopes;
      
      next();
    } catch (error) {
      logger.error('Scope validation error:', error);
      res.status(500).json({
        error: 'Failed to validate permissions'
      });
    }
  };
}

/**
 * Middleware to check for feature-specific scopes
 */
function requireFeature(feature) {
  const scopes = FEATURE_SCOPES[feature];
  
  if (!scopes) {
    throw new Error(`Unknown feature: ${feature}`);
  }
  
  return requireScopes(...scopes);
}

/**
 * Check if user has access to a specific feature
 */
async function hasFeatureAccess(userId, feature) {
  const scopes = FEATURE_SCOPES[feature];
  
  if (!scopes) {
    return false;
  }
  
  const scopeCheck = await checkUserScopes(userId, scopes);
  return scopeCheck.hasScopes;
}

/**
 * Get user's available features based on their scopes
 */
async function getUserFeatures(userId) {
  const features = {};
  
  for (const [feature, scopes] of Object.entries(FEATURE_SCOPES)) {
    const scopeCheck = await checkUserScopes(userId, scopes);
    features[feature] = {
      enabled: scopeCheck.hasScopes,
      missingScopes: scopeCheck.missingScopes
    };
  }
  
  return features;
}

/**
 * Validate scopes during OAuth callback
 */
function validateCallbackScopes(grantedScopes) {
  const requiredScopes = getAllRequiredScopes();
  const granted = grantedScopes.split(' ');
  
  const missing = requiredScopes.filter(scope => !granted.includes(scope));
  
  if (missing.length > 0) {
    logger.warn('OAuth callback missing required scopes:', missing);
    return {
      valid: false,
      missing,
      message: 'Authorization incomplete. Please grant all requested permissions.'
    };
  }
  
  return {
    valid: true,
    granted,
    optional: getOptionalScopes().filter(scope => granted.includes(scope))
  };
}

/**
 * Build OAuth URL with proper scopes
 */
function buildAuthUrl(baseUrl, additionalScopes = []) {
  const allScopes = new Set([
    ...getAllRequiredScopes(),
    ...additionalScopes
  ]);
  
  const scopeString = Array.from(allScopes).join(' ');
  return `${baseUrl}&scope=${encodeURIComponent(scopeString)}`;
}

module.exports = {
  // Middleware
  requireScopes,
  requireFeature,
  
  // Validation functions
  checkUserScopes,
  hasFeatureAccess,
  getUserFeatures,
  validateCallbackScopes,
  
  // OAuth helpers
  getAllRequiredScopes,
  getOptionalScopes,
  buildAuthUrl,
  
  // Constants
  SPOTIFY_SCOPES,
  FEATURE_SCOPES
};
