/**
 * User Query Helpers for Admin Operations
 * 
 * Reusable database queries for user management operations.
 */

const db = require('../../database');

/**
 * Build filtered user query with pagination
 */
async function getUsersWithFilters(filters, pagination) {
  const { search, status, tier } = filters;
  const { limit, offset } = pagination;
  
  // Build query with filters
  let query = `
    SELECT 
      id, spotify_id, display_name, email, 
      subscription_tier, subscription_plan, 
      status, is_verified, is_active,
      total_follows, followers,
      created_at, updated_at, last_login_at
    FROM users
    WHERE 1=1
  `;
  
  const queryParams = [];
  let paramCount = 0;
  
  if (search) {
    paramCount++;
    query += ` AND (display_name ILIKE $${paramCount} OR email ILIKE $${paramCount})`;
    queryParams.push(`%${search}%`);
  }
  
  if (status) {
    paramCount++;
    query += ` AND status = $${paramCount}`;
    queryParams.push(status);
  }
  
  if (tier) {
    paramCount++;
    query += ` AND subscription_tier = $${paramCount}`;
    queryParams.push(tier);
  }
  
  // Add ordering and pagination
  paramCount++;
  query += ` ORDER BY created_at DESC LIMIT $${paramCount}`;
  queryParams.push(parseInt(limit));
  
  paramCount++;
  query += ` OFFSET $${paramCount}`;
  queryParams.push(parseInt(offset));
  
  return db.query(query, queryParams);
}

/**
 * Get total count of users with filters
 */
async function getUserCount(filters) {
  const { search, status, tier } = filters;
  
  let countQuery = 'SELECT COUNT(*) as total FROM users WHERE 1=1';
  const countParams = [];
  let paramCount = 0;
  
  if (search) {
    paramCount++;
    countQuery += ` AND (display_name ILIKE $${paramCount} OR email ILIKE $${paramCount})`;
    countParams.push(`%${search}%`);
  }
  
  if (status) {
    paramCount++;
    countQuery += ` AND status = $${paramCount}`;
    countParams.push(status);
  }
  
  if (tier) {
    paramCount++;
    countQuery += ` AND subscription_tier = $${paramCount}`;
    countParams.push(tier);
  }
  
  const result = await db.query(countQuery, countParams);
  return parseInt(result.rows[0].total);
}

/**
 * Build and execute user update query
 */
async function updateUserFields(userId, updates) {
  const { status, subscriptionPlan, isVerified } = updates;
  
  let updateFields = [];
  let queryParams = [];
  let paramCount = 0;
  
  if (status !== undefined) {
    paramCount++;
    updateFields.push(`status = $${paramCount}`);
    queryParams.push(status);
  }
  
  if (subscriptionPlan !== undefined) {
    paramCount++;
    updateFields.push(`subscription_plan = $${paramCount}`);
    queryParams.push(subscriptionPlan);
  }
  
  if (isVerified !== undefined) {
    paramCount++;
    updateFields.push(`is_verified = $${paramCount}`);
    queryParams.push(isVerified);
  }
  
  if (updateFields.length === 0) {
    return null;
  }
  
  // Add user ID to params
  paramCount++;
  queryParams.push(userId);
  
  return db.query(
    `UPDATE users 
     SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP 
     WHERE id = $${paramCount}
     RETURNING *`,
    queryParams
  );
}

async function getUsers(params) {
  const { page = 1, limit = 20, search, status } = params;
  const offset = (page - 1) * limit;
  const result = await getUsersWithFilters({ search, status }, { limit, offset });
  return result.rows;
}

async function getUserById(userId) {
  const result = await db.query(
    'SELECT id, email, encrypted_access_token FROM users WHERE id = $1',
    [userId]
  );
  return result.rows[0] || null;
}

async function updateUser(userId, updates) {
  const result = await updateUserFields(userId, updates);
  return result ? result.rows[0] : null;
}

async function softDeleteUser(userId) {
  const result = await db.query(
    "UPDATE users SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id, updated_at",
    [userId]
  );
  return result.rows[0] || null;
}

async function getUserActivity(userId) {
  const follows = await db.query(
    `SELECT id, target_artist_id, status, created_at
     FROM follows
     WHERE follower_user_id = $1
     ORDER BY created_at DESC
     LIMIT 20`,
    [userId]
  );

  const analytics = await db.query(
    `SELECT id, event_type, event_category, created_at
     FROM analytics
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 20`,
    [userId]
  );

  return {
    recentFollows: follows.rows,
    recentAnalytics: analytics.rows
  };
}

module.exports = {
  getUsersWithFilters,
  getUserCount,
  updateUserFields,
  getUsers,
  getUserById,
  updateUser,
  softDeleteUser,
  getUserActivity
};
