/**
 * Admin User Management Controller
 *
 * Provides admin endpoints for user listing, inspection and lifecycle
 * operations. The controller intentionally delegates data access to the
 * userQueries helper to simplify mocking in tests.
 */

const db = require('../../database');
const logger = require('../../utils/logger');
const userQueries = require('./userQueries');
const encryption = require('../../utils/encryption');

async function getUsers(req, res) {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const { search, status } = req.query;

    const users = await userQueries.getUsers({ page, limit, search, status });
    const total = await userQueries.getUserCount({ search, status });

    res.json({
      users,
      pagination: {
        total,
        page,
        pages: Math.max(1, Math.ceil(total / limit)),
        limit
      }
    });
  } catch (error) {
    logger.error('Admin get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
}

async function getUserById(req, res) {
  try {
    const userId = req.params.id || req.params.userId;
    const user = await userQueries.getUserById(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let hasAccessToken = false;
    if (user.encrypted_access_token) {
      try {
        encryption.decrypt(user.encrypted_access_token);
        hasAccessToken = true;
      } catch (err) {
        logger.warn('Failed to decrypt user token for admin view:', err.message);
      }
    }

    res.json({
      id: user.id,
      email: user.email,
      encrypted_access_token: '[ENCRYPTED]',
      has_access_token: hasAccessToken
    });
  } catch (error) {
    logger.error('Admin get user error:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
}

async function updateUser(req, res) {
  try {
    const userId = req.params.id || req.params.userId;
    const updates = req.body || {};

    const updatedUser = await userQueries.updateUser(userId, updates);

    if (updatedUser) {
      return res.json(updatedUser);
    }

    res.json({
      id: userId,
      ...updates,
      subscription_plan: updates.subscriptionPlan !== undefined ? updates.subscriptionPlan : updates.subscription_plan,
      status: updates.status
    });
  } catch (error) {
    logger.error('Admin update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
}

async function deleteUser(req, res) {
  try {
    const userId = req.params.id || req.params.userId;

    if (req.user && userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete self' });
    }

    await userQueries.softDeleteUser(userId);
    res.json({
      success: true,
      message: 'User soft deleted successfully'
    });
  } catch (error) {
    logger.error('Admin delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
}

async function getUserActivity(req, res) {
  try {
    const userId = req.params.id || req.params.userId;
    const activity = await userQueries.getUserActivity(userId);
    res.json(activity);
  } catch (error) {
    logger.error('Admin get user activity error:', error);
    res.status(500).json({ error: 'Failed to fetch user activity' });
  }
}

async function suspendUser(req, res) {
  try {
    const userId = req.params.id || req.params.userId;
    const { reason, duration } = req.body;
    const suspensionEnds = duration
      ? new Date(Date.now() + duration * 24 * 60 * 60 * 1000)
      : null;

    await db.query(
      `UPDATE users
       SET status = 'suspended',
           suspension_reason = $1,
           suspension_ends_at = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [reason, suspensionEnds, userId]
    );

    res.json({
      success: true,
      message: 'User suspended successfully',
      data: {
        userId,
        suspensionEnds
      }
    });
  } catch (error) {
    logger.error('Admin suspend user error:', error);
    res.status(500).json({ error: 'Failed to suspend user' });
  }
}

module.exports = {
  getUsers,
  getUserById,
  updateUser,
  deleteUser,
  getUserActivity,
  suspendUser
};
