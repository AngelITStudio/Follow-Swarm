/**
 * Admin Statistics and Analytics Controller
 * 
 * Provides platform-wide statistics, analytics, and activity monitoring
 * for administrative dashboard and reporting.
 */

const db = require('../../database');
const logger = require('../../utils/logger');

/**
 * Get platform-wide statistics
 */
async function getStats(req, res) {
  try {
    // Get user counts by subscription tier
    const userStatsResult = await db.query(`
      SELECT 
        COUNT(*) as total_users,
        COUNT(CASE WHEN subscription_tier = 'free' THEN 1 END) as free_users,
        COUNT(CASE WHEN subscription_tier = 'pro' THEN 1 END) as pro_users,
        COUNT(CASE WHEN subscription_tier = 'premium' THEN 1 END) as premium_users,
        COUNT(CASE WHEN is_active = true THEN 1 END) as active_users,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '24 hours' THEN 1 END) as new_users_24h,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 END) as new_users_7d,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END) as new_users_30d
      FROM users
    `);
    
    // Get follow statistics
    const followStatsResult = await db.query(`
      SELECT 
        COUNT(*) as total_follows,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_follows,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_follows,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_follows,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '24 hours' THEN 1 END) as follows_24h,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 END) as follows_7d
      FROM follows
    `);
    
    // Get revenue metrics (simplified)
    const revenueResult = await db.query(`
      SELECT 
        COUNT(CASE WHEN subscription_tier = 'pro' THEN 1 END) * 10 as pro_revenue,
        COUNT(CASE WHEN subscription_tier = 'premium' THEN 1 END) * 20 as premium_revenue
      FROM users 
      WHERE is_active = true
    `);
    
    const userStats = userStatsResult.rows[0];
    const followStats = followStatsResult.rows[0];
    const revenueStats = revenueResult.rows[0];
    
    const stats = {
      users: {
        total: parseInt(userStats.total_users || 0),
        active: parseInt(userStats.active_users || 0),
        free: parseInt(userStats.free_users || 0),
        pro: parseInt(userStats.pro_users || 0),
        premium: parseInt(userStats.premium_users || 0),
        new_24h: parseInt(userStats.new_users_24h || 0),
        new_7d: parseInt(userStats.new_users_7d || 0),
        new_30d: parseInt(userStats.new_users_30d || 0)
      },
      follows: {
        total: parseInt(followStats.total_follows || 0),
        completed: parseInt(followStats.completed_follows || 0),
        failed: parseInt(followStats.failed_follows || 0),
        pending: parseInt(followStats.pending_follows || 0),
        recent_24h: parseInt(followStats.follows_24h || 0),
        recent_7d: parseInt(followStats.follows_7d || 0)
      },
      revenue: {
        monthly_recurring: 
          parseFloat(revenueStats.pro_revenue || 0) + 
          parseFloat(revenueStats.premium_revenue || 0),
        pro: parseFloat(revenueStats.pro_revenue || 0),
        premium: parseFloat(revenueStats.premium_revenue || 0)
      }
    };
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Admin stats error:', error);
    res.status(500).json({
      error: 'Failed to fetch statistics',
      message: error.message
    });
  }
}

/**
 * Get platform analytics with time-based aggregation
 */
async function getAnalytics(req, res) {
  try {
    const { period = '7d' } = req.query;
    
    // Parse period to get date range
    let periodDays;
    if (period === '24h') {
      periodDays = 1;
    } else if (period.endsWith('d')) {
      periodDays = parseInt(period) || 7;
    } else {
      periodDays = parseInt(period) || 7;
    }
    
    // Keep original period string for response
    const originalPeriod = period;
    
    // Get user growth
    const userGrowthResult = await db.query(
      `SELECT 
        DATE_TRUNC('day', created_at) as date,
        COUNT(*) as new_users
      FROM users
      WHERE created_at >= NOW() - INTERVAL '${periodDays} days'
      GROUP BY date
      ORDER BY date DESC`
    );
    
    // Get follow activity
    const followActivityResult = await db.query(
      `SELECT 
        DATE_TRUNC('day', created_at) as date,
        COUNT(*) as follows,
        COUNT(DISTINCT user_id) as unique_users
      FROM follow_tasks
      WHERE created_at >= NOW() - INTERVAL '${periodDays} days'
      GROUP BY date
      ORDER BY date DESC`
    );
    
    // Get revenue metrics
    const revenueResult = await db.query(
      `SELECT 
        DATE_TRUNC('day', created_at) as date,
        COUNT(CASE WHEN subscription_tier = 'pro' THEN 1 END) * 10 as daily_revenue,
        COUNT(CASE WHEN subscription_tier = 'premium' THEN 1 END) * 20 as premium_revenue
      FROM users
      WHERE created_at >= NOW() - INTERVAL '${periodDays} days'
      GROUP BY date
      ORDER BY date DESC`
    );
    
    res.json({
      success: true,
      data: {
        period: originalPeriod,
        userGrowth: userGrowthResult.rows,
        followActivity: followActivityResult.rows,
        revenueMetrics: revenueResult.rows
      }
    });
  } catch (error) {
    logger.error('Admin analytics error:', error);
    res.status(500).json({
      error: 'Failed to fetch analytics',
      message: error.message
    });
  }
}

/**
 * Get recent system activity
 */
async function getActivity(req, res) {
  try {
    const { limit = 50 } = req.query;
    
    // Get recent follow tasks
    const recentFollowsResult = await db.query(
      `SELECT 
        ft.*, 
        u.display_name, 
        u.email
      FROM follow_tasks ft
      JOIN users u ON ft.user_id = u.id
      ORDER BY ft.created_at DESC
      LIMIT $1`,
      [parseInt(limit)]
    );
    
    // Get recent user registrations
    const recentUsersResult = await db.query(
      `SELECT id, display_name, email, created_at
      FROM users
      ORDER BY created_at DESC
      LIMIT $1`,
      [parseInt(limit)]
    );
    
    res.json({
      success: true,
      data: {
        recentFollows: recentFollowsResult.rows,
        recentUsers: recentUsersResult.rows
      }
    });
  } catch (error) {
    logger.error('Admin activity error:', error);
    res.status(500).json({
      error: 'Failed to fetch activity',
      message: error.message
    });
  }
}

module.exports = {
  getStats,
  getAnalytics,
  getActivity
};