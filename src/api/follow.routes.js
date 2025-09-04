/**
 * Follow Operations Routes
 * 
 * API endpoints for managing Spotify follow operations:
 * - Rate limit checking
 * - Single and batch follow operations
 * - Follow scheduling and job management
 * - History and statistics retrieval
 * - Queue status monitoring
 */

const express = require('express');
const router = express.Router();
const { requireAuth, checkSubscription } = require('../middleware/auth');
const { requireFeature } = require('../middleware/scopeValidation');
const { followRateLimiter, perUserRateLimiter, addRateLimitHeaders } = require('../middleware/rateLimiter');
const followEngine = require('../services/followEngine');
const queueManager = require('../services/queueManager');
const logger = require('../utils/logger');
const db = require('../database');
const config = require('../../config');

/**
 * GET /api/follows/rate-limits
 * Get current rate limit status for user
 */
router.get('/rate-limits', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await db.findOne('users', { id: userId });
    
    const rateLimits = await followEngine.checkRateLimits(
      userId,
      user.subscription_tier
    );
    
    res.json({
      success: true,
      data: rateLimits
    });
  } catch (error) {
    logger.error('Error fetching rate limits:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch rate limits'
    });
  }
});

/**
 * GET /api/follows/suggestions
 * Get suggested artists to follow
 */
router.get('/suggestions', requireAuth, requireFeature('follow'), async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 10;
    
    const suggestions = await followEngine.getTargetArtists(userId, limit);
    
    res.json({
      success: true,
      data: suggestions
    });
  } catch (error) {
    logger.error('Error fetching suggestions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch suggestions'
    });
  }
});

/**
 * POST /api/follows/single
 * Follow a single artist immediately
 */
router.post('/single', requireAuth, requireFeature('follow'), followRateLimiter, addRateLimitHeaders, async (req, res) => {
  try {
    const userId = req.user.id;
    const { artistId } = req.body;
    
    if (!artistId) {
      return res.status(400).json({
        success: false,
        error: 'Artist ID is required'
      });
    }
    
    // Check rate limits
    const user = await db.findOne('users', { id: userId });
    const rateCheck = await followEngine.checkRateLimits(userId, user.subscription_tier);
    
    if (!rateCheck.canFollow) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        nextSlot: rateCheck.nextAvailableSlot,
        limits: rateCheck.limits
      });
    }
    
    // Add to queue with high priority
    const job = await queueManager.addFollowJob(userId, artistId, {
      priority: 10
    });
    
    res.json({
      success: true,
      data: {
        jobId: job.id,
        artistId,
        status: 'queued'
      }
    });
  } catch (error) {
    logger.error('Error creating follow job:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create follow job'
    });
  }
});

/**
 * POST /api/follows/batch
 * Queue multiple artists to follow
 */
router.post('/batch', requireAuth, requireFeature('follow'), checkSubscription(['pro', 'premium']), followRateLimiter, addRateLimitHeaders, async (req, res) => {
  try {
    const userId = req.user.id;
    const { artistIds, options = {} } = req.body;
    
    if (!artistIds || !Array.isArray(artistIds) || artistIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Artist IDs array is required'
      });
    }
    
    if (artistIds.length > config.rateLimits.batchSize) {
      return res.status(400).json({
        success: false,
        error: `Batch size exceeds maximum of ${config.rateLimits.batchSize}`
      });
    }
    
    // Add batch to queue
    const jobs = await queueManager.addBatchFollowJobs(userId, artistIds, options);
    
    res.json({
      success: true,
      data: {
        jobCount: jobs.length,
        jobIds: jobs.map(j => j.id),
        estimatedCompletionTime: calculateEstimatedTime(jobs.length)
      }
    });
  } catch (error) {
    logger.error('Error creating batch follow jobs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create batch follow jobs'
    });
  }
});

/**
 * POST /api/follows/schedule
 * Schedule follows with custom timing
 */
router.post('/schedule', requireAuth, requireFeature('follow'), checkSubscription(['premium']), perUserRateLimiter, addRateLimitHeaders, async (req, res) => {
  try {
    const userId = req.user.id;
    const { artistIds, startTime, endTime, distribution = 'even' } = req.body;
    
    if (!artistIds || !Array.isArray(artistIds)) {
      return res.status(400).json({
        success: false,
        error: 'Artist IDs array is required'
      });
    }
    
    const start = new Date(startTime || Date.now());
    const end = new Date(endTime || Date.now() + 24 * 60 * 60 * 1000);
    
    // Calculate delays based on distribution
    const timeSpan = end.getTime() - start.getTime();
    const delayBetween = timeSpan / artistIds.length;
    
    const jobs = await followEngine.scheduleBatchFollows(userId, artistIds, {
      priority: 5,
      delayBetween,
      startTime: start
    });
    
    res.json({
      success: true,
      data: {
        scheduled: jobs.length,
        startTime: start,
        endTime: end,
        distribution
      }
    });
  } catch (error) {
    logger.error('Error scheduling follows:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to schedule follows'
    });
  }
});

/**
 * GET /api/follows/history
 * Get user's follow history
 */
router.get('/history', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, limit = 50, offset = 0 } = req.query;
    
    let query = `
      SELECT f.*, u.display_name as artist_name, u.spotify_data
      FROM follows f
      LEFT JOIN users u ON u.spotify_id = f.target_artist_id
      WHERE f.follower_user_id = $1
    `;
    
    const params = [userId];
    
    if (status) {
      query += ` AND f.status = $2`;
      params.push(status);
    }
    
    query += ` ORDER BY f.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    
    const result = await db.query(query, params);
    
    res.json({
      success: true,
      data: result.rows,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: result.rowCount
      }
    });
  } catch (error) {
    logger.error('Error fetching follow history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch follow history'
    });
  }
});

/**
 * GET /api/follows/stats
 * Get follow statistics
 */
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { period = '7d' } = req.query;
    
    const stats = await followEngine.getUserStats(userId, period);
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Error fetching stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics'
    });
  }
});

/**
 * GET /api/follows/jobs
 * Get user's queued jobs
 */
router.get('/jobs', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { status } = req.query;
    
    const jobs = await queueManager.getUserJobs(userId, status);
    
    res.json({
      success: true,
      data: jobs
    });
  } catch (error) {
    logger.error('Error fetching jobs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch jobs'
    });
  }
});

/**
 * DELETE /api/follows/jobs
 * Cancel all pending jobs
 */
router.delete('/jobs', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const cancelled = await queueManager.cancelUserJobs(userId);
    
    res.json({
      success: true,
      data: {
        cancelledCount: cancelled.length,
        jobs: cancelled
      }
    });
  } catch (error) {
    logger.error('Error cancelling jobs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel jobs'
    });
  }
});

/**
 * DELETE /api/follows/jobs/:jobId
 * Cancel specific job
 */
router.delete('/jobs/:jobId', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { jobId } = req.params;
    
    // Verify job belongs to user
    const job = await db.findOne('queue_jobs', { 
      id: jobId,
      user_id: userId 
    });
    
    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }
    
    if (job.status !== 'queued' && job.status !== 'scheduled') {
      return res.status(400).json({
        success: false,
        error: 'Job cannot be cancelled'
      });
    }
    
    // Cancel the job
    await db.update('queue_jobs', jobId, {
      status: 'cancelled',
      completed_at: new Date()
    });
    
    res.json({
      success: true,
      data: {
        jobId,
        status: 'cancelled'
      }
    });
  } catch (error) {
    logger.error('Error cancelling job:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel job'
    });
  }
});

/**
 * GET /api/follows/queue-status
 * Get queue status (admin only)
 */
router.get('/queue-status', requireAuth, async (req, res) => {
  try {
    // Check if user is admin (you might want to implement proper admin check)
    const user = await db.findOne('users', { id: req.user.id });
    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }
    
    const status = await queueManager.getQueueStatus('follow');
    
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    logger.error('Error fetching queue status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch queue status'
    });
  }
});

/**
 * Helper function to calculate estimated completion time
 */
function calculateEstimatedTime(jobCount) {
  const avgDelay = (config.rateLimits.followDelayMin + config.rateLimits.followDelayMax) / 2;
  const totalTime = jobCount * avgDelay;
  return new Date(Date.now() + totalTime);
}

module.exports = router;