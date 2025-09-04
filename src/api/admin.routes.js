/**
 * Admin Routes
 * 
 * Protected endpoints for admin functionality including user management,
 * system metrics, and administrative controls. This file delegates to
 * specialized controllers for better code organization and maintainability.
 */

const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const { requireSoft2FA } = require('../middleware/require2FA');
const logger = require('../utils/logger');

// Import controllers
const usersController = require('../controllers/admin/adminUsers.controller');
const statsController = require('../controllers/admin/adminStats.controller');
const systemController = require('../controllers/admin/adminSystem.controller');

// Debug logging for all admin routes
router.use((req, res, next) => {
  logger.info(`[ADMIN ROUTE] ${req.method} ${req.originalUrl}`);
  logger.info(`[ADMIN ROUTE] Headers: ${JSON.stringify({
    authorization: req.headers.authorization ? 'Present' : 'Missing',
    cookie: req.headers.cookie ? 'Present' : 'Missing'
  })}`);
  next();
});

/**
 * Apply authentication first, then 2FA check
 * Need to authenticate user before checking 2FA requirements
 */
router.use(isAuthenticated);
router.use(requireAdmin);

/**
 * Apply 2FA check to all admin routes AFTER authentication
 * Using soft enforcement during grace period (logs warnings but allows access)
 * TODO: Switch to requireStrict2FA after 2FA UI is implemented
 */
router.use(requireSoft2FA);

/**
 * Statistics and Analytics Routes
 */
router.get('/stats', statsController.getStats);
router.get('/analytics', statsController.getAnalytics);
router.get('/activity', statsController.getActivity);

/**
 * User Management Routes
 */
router.get('/users', usersController.getUsers);
router.get('/users/:userId', usersController.getUserById);
router.put('/users/:userId', usersController.updateUser);
router.delete('/users/:userId', usersController.deleteUser);
router.post('/users/:userId/suspend', usersController.suspendUser);

/**
 * System Operations Routes
 */
router.post('/system/cache/clear', systemController.clearCache);
router.get('/logs', systemController.getLogs);
router.get('/security/suspicious', systemController.getSuspiciousActivity);

module.exports = router;