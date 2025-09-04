/**
 * Admin Authentication Middleware
 * 
 * Verifies that authenticated users have admin privileges
 * before allowing access to administrative endpoints.
 */

const db = require('../database');
const logger = require('../utils/logger');

/**
 * Middleware to check admin privileges
 */
async function requireAdmin(req, res, next) {
  try {
    // Fetch user from database using authenticated user ID
    const result = await db.query(
      'SELECT * FROM users WHERE id = $1',
      [req.user?.id || req.session?.userId]
    );
    
    const user = result.rows[0];
    
    // Check if user has admin role
    if (!user || user.role !== 'admin') {
      logger.warn(`Access denied for user ${user?.email || 'unknown'} with role ${user?.role || 'none'}`);
      return res.status(403).json({
        error: 'Access denied',
        message: 'Admin privileges required'
      });
    }
    
    req.user = user;
    next();
  } catch (error) {
    logger.error('Admin check error:', error);
    res.status(500).json({
      error: 'Authorization failed',
      message: 'Failed to verify admin status'
    });
  }
}

module.exports = {
  requireAdmin
};