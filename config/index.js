require('dotenv').config();

module.exports = {
  server: {
    port: process.env.PORT || 3001,
    host: process.env.HOST || 'localhost',
    env: process.env.NODE_ENV || 'development',
    corsOrigin: (() => {
      const rawOrigins = process.env.CORS_ALLOWED_ORIGINS;
      if (!rawOrigins) {
        return null;
      }

      const origins = rawOrigins
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean);

      if (origins.length === 0) {
        return null;
      }

      return origins.length === 1 ? origins[0] : origins;
    })()
  },
  
  spotify: {
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.SPOTIFY_REDIRECT_URI,
    scopes: [
      'user-follow-modify',
      'user-follow-read',
      'user-read-private',
      'user-read-email',
      'user-library-read'
    ]
  },
  
  database: {
    url: process.env.DATABASE_URL || null,
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT) || 5432,
    database: process.env.DATABASE_NAME || 'spotify_swarm',
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'postgres',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
  },
  
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    retryStrategy: (times) => Math.min(times * 50, 2000)
  },
  
  security: {
    jwtSecret: process.env.JWT_SECRET || 'default_jwt_secret_change_in_production',
    encryptionKey: process.env.ENCRYPTION_KEY || 'default_encryption_key_change_me',
    sessionSecret: process.env.SESSION_SECRET || 'default_session_secret_change_me',
    bcryptRounds: 10
  },
  
  rateLimits: {
    maxFollowsPerHour: parseInt(process.env.MAX_FOLLOWS_PER_HOUR) || 30,
    maxFollowsPerDay: parseInt(process.env.MAX_FOLLOWS_PER_DAY) || 500,
    maxFollowsPerMonth: parseInt(process.env.MAX_FOLLOWS_PER_MONTH) || 10000,
    followDelayMin: parseInt(process.env.FOLLOW_DELAY_MIN) || 120000,
    followDelayMax: parseInt(process.env.FOLLOW_DELAY_MAX) || 240000,
    batchSize: 100
  },
  
  queue: {
    concurrency: parseInt(process.env.QUEUE_CONCURRENCY) || 1,
    maxJobAttempts: parseInt(process.env.MAX_JOB_ATTEMPTS) || 3,
    backoffDelay: parseInt(process.env.JOB_BACKOFF_DELAY) || 60000
  },
  
  subscriptions: {
    free: {
      name: 'Free',
      price: 0,
      maxFollowsPerMonth: 100,
      features: ['basic_follow', 'progress_tracking']
    },
    pro: {
      name: 'Pro',
      price: 500, // in cents
      maxFollowsPerMonth: 1000,
      features: ['basic_follow', 'progress_tracking', 'analytics', 'scheduling']
    },
    premium: {
      name: 'Premium',
      price: 1000, // in cents
      maxFollowsPerMonth: -1, // unlimited
      features: ['basic_follow', 'progress_tracking', 'analytics', 'scheduling', 'csv_export', 'priority_queue']
    }
  },
  
  logging: {
    level: process.env.LOG_LEVEL || 'debug',
    sentryDsn: process.env.SENTRY_DSN || null
  }
};
