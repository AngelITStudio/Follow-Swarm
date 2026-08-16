// Test setup file
process.env.NODE_ENV = 'test';
process.env.PORT = '0'; // Use random available port for tests
process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/spotify_swarm_test';
process.env.REDIS_URL = 'redis://localhost:6379/1';
process.env.JWT_SECRET = 'test_jwt_secret';
process.env.ENCRYPTION_KEY = 'test_encryption_key_32_chars_xxx';
process.env.SESSION_SECRET = 'test_session_secret';

// Import cleanup helper
const { setupTestLifecycle } = require('./helpers/cleanup');
setupTestLifecycle();

// Clear mocks before each test suite, not individual tests
beforeAll(() => {
  // Clear mock data for fresh test suite
  global.mockUsers.clear();
  global.mockFollows.clear();
  global.mockQueueJobs.clear();
  global.mockAnalytics.clear();
  global.mockUserId = 1;
  global.mockFollowId = 1;
  global.mockJobId = 1;
  global.mockAnalyticsId = 1;
});

// Mock console to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Mock Redis in test environment
// Provides a complete mock implementation to avoid Redis dependency in tests
// Handles both direct client methods and module-level convenience methods
jest.mock('../src/database/redis', () => {
  const mockClient = {
    set: jest.fn((key, value, ...args) => {
      // Handle EX option
      if (args[0] === 'EX') {
        return Promise.resolve('OK');
      }
      return Promise.resolve('OK');
    }),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    exists: jest.fn().mockResolvedValue(0),
    incr: jest.fn().mockResolvedValue(1),
    zadd: jest.fn().mockResolvedValue(1),
    zrem: jest.fn().mockResolvedValue(1),
    zrange: jest.fn().mockResolvedValue([]),
    hset: jest.fn().mockResolvedValue(1),
    hget: jest.fn().mockResolvedValue(null),
    hgetall: jest.fn().mockResolvedValue({}),
    lpush: jest.fn().mockResolvedValue(1),
    lrange: jest.fn().mockResolvedValue([]),
    quit: jest.fn().mockResolvedValue('OK'),
    ping: jest.fn().mockResolvedValue('PONG'),
    flushall: jest.fn().mockResolvedValue('OK'),
    flushdb: jest.fn().mockResolvedValue('OK'),
  };
  
  const mockRedis = {
    client: mockClient,
    publisher: {
      publish: jest.fn().mockResolvedValue(1),
    },
    subscriber: {
      subscribe: jest.fn().mockResolvedValue('OK'),
      on: jest.fn(),
    },
    connect: jest.fn().mockReturnValue(mockClient),
    disconnect: jest.fn().mockResolvedValue(true),
    cacheToken: jest.fn().mockResolvedValue('OK'),
    getCachedToken: jest.fn().mockResolvedValue(null),
    invalidateToken: jest.fn().mockResolvedValue(1),
    incrementRateLimit: jest.fn().mockResolvedValue(1),
    set: jest.fn((...args) => mockClient.set(...args)),
    get: jest.fn((key) => mockClient.get(key)),
    del: jest.fn((key) => mockClient.del(key)),
  };
  
  return mockRedis;
});

// Mock Database in test environment
// Reset these for each test file
global.mockUsers = global.mockUsers || new Map();
global.mockFollows = global.mockFollows || new Map();
global.mockQueueJobs = global.mockQueueJobs || new Map();
global.mockAnalytics = global.mockAnalytics || new Map();
global.mockUserId = global.mockUserId || 1;
global.mockFollowId = global.mockFollowId || 1;
global.mockJobId = global.mockJobId || 1;
global.mockAnalyticsId = global.mockAnalyticsId || 1;

const mockUsers = global.mockUsers;
const mockFollows = global.mockFollows;
const mockQueueJobs = global.mockQueueJobs;
const mockAnalytics = global.mockAnalytics;

jest.mock('../src/database', () => ({
  connect: jest.fn().mockResolvedValue(true),
  disconnect: jest.fn().mockResolvedValue(true),
  healthCheck: jest.fn().mockResolvedValue({
    status: 'healthy',
    message: 'Database is responsive',
    responseTime: 10,
    poolStats: {
      totalCount: 10,
      idleCount: 5,
      waitingCount: 0
    },
    timestamp: new Date().toISOString()
  }),
  query: jest.fn().mockImplementation((sql, params) => {
    // Mock responses for common queries
    if (sql.includes('SELECT * FROM users WHERE id')) {
      const userId = params?.[0]?.toString(); // Convert to string
      const user = mockUsers.get(userId);
      return Promise.resolve({ rows: user ? [user] : [] });
    }
    // Mock follow count query for rate limiting
    if (sql.includes('COUNT') && sql.includes('follows')) {
      // Check if this is a rate limit test (looking for high follow count)
      const userId = params?.[0]?.toString();
      const since = params?.[1];
      
      // Return high count for rate limit testing
      if (global.__testRateLimit && global.__testRateLimit[userId]) {
        return Promise.resolve({ rows: [{ count: '35' }] });
      }
      
      // Count actual follows for the user
      let follows = Array.from(mockFollows.values()).filter(
        follow => follow.follower_user_id === userId || follow.follower_user_id === userId?.toString()
      );
      
      // Filter by status if the query includes status filter
      if (sql.includes("status IN ('pending', 'completed')")) {
        follows = follows.filter(f => f.status === 'pending' || f.status === 'completed');
      } else if (sql.includes("status = 'completed'")) {
        follows = follows.filter(f => f.status === 'completed');
      }
      
      // Filter by date if provided
      if (since) {
        const sinceTime = new Date(since).getTime();
        follows = follows.filter(f => {
          const followTime = f.created_at ? new Date(f.created_at).getTime() : Date.now();
          return followTime >= sinceTime;
        });
      }
      
      return Promise.resolve({ rows: [{ count: String(follows.length) }] });
    }
    // Handle getUserStats query with COUNT FILTER for follows
    if (sql.includes('COUNT(*) FILTER') && sql.includes('FROM follows')) {
      const userId = params?.[0];
      const since = params?.[1];
      
      let userFollows = Array.from(mockFollows.values()).filter(
        follow => follow.follower_user_id === userId || follow.follower_user_id === userId?.toString()
      );
      
      // Filter by date if provided
      if (since) {
        const sinceTime = new Date(since).getTime();
        userFollows = userFollows.filter(follow => {
          const followTime = follow.created_at ? new Date(follow.created_at).getTime() : Date.now();
          return followTime >= sinceTime;
        });
      }
      
      const completed = userFollows.filter(f => f.status === 'completed').length;
      const pending = userFollows.filter(f => f.status === 'pending').length;
      const failed = userFollows.filter(f => f.status === 'failed').length;
      const total = userFollows.length;
      
      return Promise.resolve({ 
        rows: [{
          completed: String(completed),
          pending: String(pending),
          failed: String(failed),
          total: String(total),
          first_follow: userFollows[0]?.created_at || null,
          last_follow: userFollows.find(f => f.status === 'completed')?.completed_at || null
        }]
      });
    }
    // Skip this generic handler for analytics queries
    if (sql.includes('COUNT') && !sql.includes('analytics')) {
      return Promise.resolve({ rows: [{ count: '10', total: 10 }] });
    }
    if (sql.includes('FROM follows') || (sql.includes('SELECT') && sql.includes('follows'))) {
      // Handle LEFT JOIN query from follow routes
      const userId = params?.[0];
      let userFollows = Array.from(mockFollows.values()).filter(
        follow => follow.follower_user_id === userId
      );
      
      // If status filter is provided (second parameter)
      if (params?.[1]) {
        userFollows = userFollows.filter(follow => follow.status === params[1]);
      }
      
      // Add artist_name field for LEFT JOIN queries
      if (sql.includes('LEFT JOIN')) {
        userFollows = userFollows.map(follow => ({
          ...follow,
          artist_name: `Artist ${follow.target_artist_id}`,
          spotify_data: null
        }));
      }
      
      return Promise.resolve({ rows: userFollows, rowCount: userFollows.length });
    }
    // Handle daily stats GROUP BY for follows
    if (sql.includes('DATE(created_at)') && sql.includes('FROM follows') && sql.includes('GROUP BY')) {
      const userId = params?.[0];
      const since = params?.[1];
      
      let userFollows = Array.from(mockFollows.values()).filter(
        follow => (follow.follower_user_id === userId || follow.follower_user_id === userId?.toString()) &&
                  follow.status === 'completed'
      );
      
      // Filter by date if provided
      if (since) {
        const sinceTime = new Date(since).getTime();
        userFollows = userFollows.filter(follow => {
          const followTime = follow.created_at ? new Date(follow.created_at).getTime() : Date.now();
          return followTime >= sinceTime;
        });
      }
      
      // Group by date
      const grouped = {};
      userFollows.forEach(follow => {
        const date = new Date(follow.created_at || Date.now()).toISOString().split('T')[0];
        grouped[date] = (grouped[date] || 0) + 1;
      });
      
      const rows = Object.entries(grouped).map(([date, count]) => ({
        date,
        count: String(count)
      })).sort((a, b) => b.date.localeCompare(a.date));
      
      return Promise.resolve({ rows });
    }
    // Handle UPDATE queue_jobs for cancelling
    if (sql.includes('UPDATE queue_jobs') && sql.includes('cancelled')) {
      const userId = params?.[0]?.toString();
      const cancelledJobs = [];
      
      for (const [key, job] of mockQueueJobs.entries()) {
        if ((job.user_id === userId || job.user_id === userId?.toString()) &&
            (job.status === 'scheduled' || job.status === 'rescheduled' || job.status === 'queued')) {
          job.status = 'cancelled';
          job.completed_at = new Date();
          cancelledJobs.push({ ...job });
        }
      }
      
      return Promise.resolve({ rows: cancelledJobs, rowCount: cancelledJobs.length });
    }
    if (sql.includes('UPDATE users') && sql.includes('SET')) {
      // Extract the user ID from the WHERE clause
      const userId = params?.[params.length - 1]?.toString();
      const user = mockUsers.get(userId);
      if (user) {
        // Update the user in the mock store
        const updatedUser = { ...user };
        // Parse the SET clause to update fields
        if (sql.includes('subscription_plan')) {
          const planIndex = params.findIndex(p => ['free', 'pro', 'premium'].includes(p));
          if (planIndex !== -1) updatedUser.subscription_plan = params[planIndex];
        }
        if (sql.includes('status')) {
          // Check for status literals in the SQL query itself
          if (sql.includes("status = 'deleted'")) {
            updatedUser.status = 'deleted';
          } else if (sql.includes("status = 'suspended'")) {
            updatedUser.status = 'suspended';
          } else {
            const statusIndex = params.findIndex(p => ['active', 'inactive', 'suspended', 'deleted'].includes(p));
            if (statusIndex !== -1) updatedUser.status = params[statusIndex];
          }
        }
        mockUsers.set(userId, updatedUser);
        return Promise.resolve({ rows: [updatedUser], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    if (sql.includes('DELETE FROM users')) {
      const userId = params?.[0]?.toString();
      if (mockUsers.has(userId)) {
        mockUsers.delete(userId);
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    // Handle admin stats queries
    if (sql.includes('COUNT(CASE WHEN subscription_tier')) {
      // Admin stats query for user counts - check which table
      if (sql.includes('FROM users')) {
        // User statistics query
        return Promise.resolve({ rows: [{
          total_users: '10',
          free_users: '5',
          pro_users: '3',
          premium_users: '2',
          active_users: '8',
          new_users_24h: '1',
          new_users_7d: '3',
          new_users_30d: '5'
        }] });
      } else {
        // Revenue query (simplified calculation)
        return Promise.resolve({ rows: [{
          pro_revenue: '30',
          premium_revenue: '40'
        }] });
      }
    }
    if (sql.includes('COUNT(CASE WHEN status = \'completed\'')) {
      // Admin stats query for follows
      return Promise.resolve({ rows: [{
        total_follows: '100',
        completed_follows: '80',
        failed_follows: '10',
        pending_follows: '10',
        follows_24h: '20',
        follows_7d: '50'
      }] });
    }
    // Handle analytics queries
    if (sql.includes('FROM analytics')) {
      const userId = params?.[0]?.toString();
      
      // Get analytics events for user
      let analyticsEvents = Array.from(mockAnalytics.values()).filter(
        event => event.user_id === userId || event.user_id === userId?.toString()
      );
      
      // Handle DATE_TRUNC for monthly recurring revenue FIRST (must be before other handlers)
      if (sql.includes('DATE_TRUNC') && sql.includes('SUM((event_data')) {
        // Filter for subscription renewal/upgrade events
        const mrrEvents = analyticsEvents.filter(
          e => (e.event_type === 'subscription_renewed' || e.event_type === 'subscription_upgrade')
        );
        
        if (mrrEvents.length > 0) {
          const mrr = mrrEvents.reduce((sum, event) => {
            const amount = parseFloat(event.event_data?.amount || 0);
            return sum + amount;
          }, 0);
          
          return Promise.resolve({
            rows: [{
              month: new Date().toISOString(),
              mrr: mrr.toFixed(2)
            }]
          });
        }
        
        return Promise.resolve({ rows: [] });
      }
      
      // Handle GROUP BY event_type
      if (sql.includes('GROUP BY event_type')) {
        const grouped = {};
        analyticsEvents.forEach(event => {
          if (!grouped[event.event_type]) {
            grouped[event.event_type] = 0;
          }
          grouped[event.event_type]++;
        });
        
        const rows = Object.entries(grouped).map(([event_type, count]) => ({
          event_type,
          count: String(count)
        })).sort((a, b) => parseInt(b.count) - parseInt(a.count));
        
        return Promise.resolve({ rows });
      }
      
      // Handle GROUP BY event_category
      if (sql.includes('GROUP BY event_category')) {
        const grouped = {};
        analyticsEvents.forEach(event => {
          if (!grouped[event.event_category]) {
            grouped[event.event_category] = { total: 0, users: new Set() };
          }
          grouped[event.event_category].total++;
          grouped[event.event_category].users.add(event.user_id);
        });
        
        const rows = Object.entries(grouped).map(([event_category, data]) => ({
          event_category,
          total_events: String(data.total),
          unique_users: String(data.users.size)
        }));
        
        return Promise.resolve({ rows });
      }
      
      // Handle COUNT with FILTER for engagement metrics
      if (sql.includes('COUNT(*) FILTER')) {
        const engagementEvents = analyticsEvents.filter(e => e.event_category === 'engagement').length;
        const coreActions = analyticsEvents.filter(e => e.event_category === 'core_action').length;
        
        return Promise.resolve({
          rows: [{
            engagement_events: String(engagementEvents),
            core_actions: String(coreActions),
            total_events: String(analyticsEvents.length)
          }]
        });
      }
      
      // Handle SUM for revenue analytics
      if (sql.includes('SUM((event_data')) {
        // Check if query is filtering by specific event_type
        let revenueEvents;
        if (sql.includes("event_type = 'payment_completed'")) {
          revenueEvents = analyticsEvents.filter(e => e.event_type === 'payment_completed');
        } else {
          revenueEvents = analyticsEvents.filter(
            e => e.event_type === 'payment_completed' || 
                 e.event_type === 'subscription_renewed' ||
                 e.event_type === 'subscription_upgrade'
          );
        }
        
        const totalRevenue = revenueEvents.reduce((sum, event) => {
          const amount = event.event_data?.amount || 0;
          return sum + parseFloat(amount);
        }, 0);
        
        const paymentCount = revenueEvents.filter(e => e.event_type === 'payment_completed').length;
        
        return Promise.resolve({
          rows: [{
            total_revenue: totalRevenue.toFixed(2),
            payment_count: String(paymentCount)
          }]
        });
      }
      
      // Handle daily active users query
      if (sql.includes('DATE(created_at)') && sql.includes('COUNT(DISTINCT user_id)')) {
        const todayEvents = analyticsEvents.filter(event => {
          if (event.event_type !== 'session_start') return false;
          const eventDate = new Date(event.created_at);
          const today = new Date();
          return eventDate.toDateString() === today.toDateString();
        });
        
        const uniqueUsers = new Set(todayEvents.map(e => e.user_id));
        
        if (uniqueUsers.size > 0) {
          return Promise.resolve({
            rows: [{
              date: new Date().toISOString().split('T')[0],
              active_users: String(uniqueUsers.size)
            }]
          });
        }
        
        return Promise.resolve({ rows: [] });
      }
      
      // Handle COUNT queries
      if (sql.includes('COUNT(*)')) {
        // Filter by date if provided
        if (params?.[1]) {
          const since = new Date(params[1]).getTime();
          analyticsEvents = analyticsEvents.filter(event => {
            const eventTime = new Date(event.created_at).getTime();
            return eventTime > since;
          });
        }
        
        // Filter by event_type if specified
        if (sql.includes("event_type = 'session_start'")) {
          analyticsEvents = analyticsEvents.filter(e => e.event_type === 'session_start');
        }
        
        return Promise.resolve({ 
          rows: [{ 
            recent_events: String(analyticsEvents.length),
            count: String(analyticsEvents.length) 
          }] 
        });
      }
      
      return Promise.resolve({ rows: analyticsEvents });
    }
    
    // Handle other analytics queries
    if (sql.includes('DELETE FROM analytics')) {
      const userId = params?.[0]?.toString();
      const keysToDelete = [];
      for (const [key, value] of mockAnalytics.entries()) {
        // Compare both as strings and handle both id formats
        if (value.user_id?.toString() === userId || value.user_id === userId) {
          keysToDelete.push(key);
        }
      }
      // Delete after iteration to avoid iterator issues
      keysToDelete.forEach(key => mockAnalytics.delete(key));
      return Promise.resolve({ rows: [], rowCount: keysToDelete.length });
    }
    
    // Handle analytics/admin queries
    if (sql.includes('DATE_TRUNC') || sql.includes('security_logs') || sql.includes('suspicious_ips')) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
  }),
  insert: jest.fn().mockImplementation((table, data) => {
    if (table === 'users') {
      const id = global.mockUserId++;
      const record = { id: id.toString(), ...data }; // Store as string to match UUID format
      mockUsers.set(id.toString(), record);
      return Promise.resolve(record);
    } else if (table === 'follows') {
      const id = global.mockFollowId++;
      const record = { id: id.toString(), ...data };
      mockFollows.set(id.toString(), record);
      return Promise.resolve(record);
    } else if (table === 'queue_jobs') {
      const id = global.mockJobId++;
      const record = { id: id.toString(), ...data };
      mockQueueJobs.set(id.toString(), record);
      return Promise.resolve(record);
    } else if (table === 'analytics') {
      const id = global.mockAnalyticsId++;
      const record = { 
        id: id.toString(), 
        ...data,
        created_at: data.created_at || new Date()
      };
      mockAnalytics.set(id.toString(), record);
      return Promise.resolve(record);
    }
    const id = global.mockUserId++;
    const record = { id: id.toString(), ...data };
    return Promise.resolve(record);
  }),
  update: jest.fn().mockImplementation((table, id, data) => {
    const idStr = id?.toString();
    if (table === 'queue_jobs' && mockQueueJobs.has(idStr)) {
      const job = mockQueueJobs.get(idStr);
      Object.assign(job, data);
      return Promise.resolve(job);
    }
    return Promise.resolve({ rows: [{ id: 1 }] });
  }),
  delete: jest.fn().mockImplementation((table, id) => {
    const idStr = id?.toString();
    if (table === 'users') {
      mockUsers.delete(idStr);
    } else if (table === 'follows') {
      mockFollows.delete(idStr);
    } else if (table === 'queue_jobs') {
      mockQueueJobs.delete(idStr);
    }
    return Promise.resolve({ rows: [{ id: idStr }] });
  }),
  get: jest.fn().mockResolvedValue(null),
  findOne: jest.fn().mockImplementation((table, criteria) => {
    if (table === 'users' && criteria.id) {
      const userId = criteria.id?.toString();
      return Promise.resolve(mockUsers.get(userId) || null);
    }
    if (table === 'queue_jobs') {
      // Find job by id and user_id
      if (criteria.id && criteria.user_id) {
        const job = mockQueueJobs.get(criteria.id);
        if (job && job.user_id === criteria.user_id) {
          return Promise.resolve(job);
        }
      }
      // Find job by id only
      if (criteria.id) {
        return Promise.resolve(mockQueueJobs.get(criteria.id) || null);
      }
    }
    return Promise.resolve(null);
  }),
  findById: jest.fn().mockImplementation((table, id) => {
    if (table === 'users') {
      return Promise.resolve(mockUsers.get(id) || null);
    }
    return Promise.resolve(null);
  }),
  pool: {
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn()
    })
  }
}));

// Mock Bot Protection Middleware
jest.mock('../src/middleware/botProtection', () => {
  const actual = jest.requireActual('../src/middleware/botProtection');

  return {
    ...actual,
    signupRateLimiter: (req, res, next) => next(),
    oauthRateLimiter: (req, res, next) => next(),
    apiRateLimiter: (req, res, next) => next(),
    checkHoneypot: (req, res, next) => {
      const body = req.body || {};
      const honeypotFields = ['website', 'url', 'company', 'fax', 'phone_number'];

      for (const field of honeypotFields) {
        if (body[field]) {
          return res.status(400).json({ error: 'Invalid request' });
        }
      }
      next();
    },
    trackSignupBehavior: (req, res, next) => {
      if (!req.session.signupMetrics) {
        req.session.signupMetrics = {
          pageLoadTime: Date.now(),
          interactionCount: 0,
          mouseEvents: 0,
          keyboardEvents: 0,
          focusEvents: 0
        };
      }

      if (req.body && req.body._metrics) {
        const metrics = req.body._metrics;
        req.session.signupMetrics.mouseEvents = metrics.mouseEvents || 0;
        req.session.signupMetrics.keyboardEvents = metrics.keyboardEvents || 0;
        req.session.signupMetrics.focusEvents = metrics.focusEvents || 0;
        req.session.signupMetrics.interactionCount += 1;
        delete req.body._metrics;
      }
      next();
    },
    checkSuspiciousIP: (req, res, next) => next(),
    detectBot: (req, res, next) => next(),
    verifySpotifyAccount: jest.fn().mockResolvedValue(0.1),
    analyzeSignupBehavior: actual.analyzeSignupBehavior,
    logSuspiciousActivity: jest.fn().mockResolvedValue(undefined),
    initializeBotProtection: jest.fn().mockResolvedValue(undefined)
  };
});

// Mock Queue Manager in test environment
const mockQueueManager = {
  isInitialized: false,
  initialize: jest.fn().mockImplementation(function() {
    this.isInitialized = true;
    return Promise.resolve(true);
  }),
  shutdown: jest.fn().mockImplementation(function() {
    this.isInitialized = false;
    return Promise.resolve(true);
  }),
  addFollowJob: jest.fn().mockResolvedValue({ id: 'test-job-1', status: 'queued' }),
  addBatchFollowJobs: jest.fn().mockImplementation((userId, artistIds) => {
    // Return array of jobs matching the number of artistIds
    return Promise.resolve(
      artistIds.map((artistId, index) => ({
        id: `test-job-${index + 1}`,
        status: 'queued'
      }))
    );
  }),
  getUserJobs: jest.fn().mockImplementation((userId, status) => {
    const userJobs = Array.from(mockQueueJobs.values()).filter(job => {
      if (job.user_id !== userId && job.user_id !== userId?.toString()) return false;
      if (status && job.status !== status) return false;
      return true;
    });
    return Promise.resolve(userJobs);
  }),
  cancelUserJobs: jest.fn().mockImplementation((userId) => {
    // Find all pending/queued jobs for this user and cancel them
    const userJobs = Array.from(mockQueueJobs.values()).filter(
      job => job.user_id === userId && (job.status === 'queued' || job.status === 'scheduled')
    );
    
    // Mark them as cancelled
    userJobs.forEach(job => {
      job.status = 'cancelled';
    });
    
    return Promise.resolve(userJobs);
  }),
  getQueueStatus: jest.fn().mockImplementation((queueName) => {
    if (queueName === 'invalid') {
      return Promise.reject(new Error('Queue invalid not found'));
    }
    return Promise.resolve({
      name: queueName,
      counts: {
        waiting: 5,
        active: 2,
        completed: 100,
        failed: 3,
        delayed: 1
      },
      isPaused: false,
      workers: 1
    });
  }),
  pauseQueue: jest.fn().mockResolvedValue(true),
  cleanupOldJobs: jest.fn().mockImplementation((daysOld = 30) => {
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
    let removedCount = 0;
    
    // Find and delete old completed jobs
    for (const [key, job] of mockQueueJobs.entries()) {
      if (job.status === 'completed' && job.completed_at) {
        const completedDate = new Date(job.completed_at);
        if (completedDate < cutoffDate) {
          mockQueueJobs.delete(key);
          removedCount++;
        }
      }
    }
    
    return Promise.resolve({ removed: removedCount });
  }),
  queues: {
    follow: {
      add: jest.fn().mockResolvedValue({ id: 'test-job-1' }),
      pause: jest.fn().mockResolvedValue(true),
      resume: jest.fn().mockResolvedValue(true),
      clean: jest.fn().mockResolvedValue([]),
      close: jest.fn().mockResolvedValue(true),
    },
    analytics: {
      add: jest.fn().mockResolvedValue({ id: 'test-analytics-1' }),
      close: jest.fn().mockResolvedValue(true),
    },
    notification: {
      add: jest.fn().mockResolvedValue({ id: 'test-notification-1' }),
      close: jest.fn().mockResolvedValue(true),
    }
  }
};

// Set the mock object
jest.mock('../src/services/queueManager', () => mockQueueManager);
