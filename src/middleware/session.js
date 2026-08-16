/**
 * Session Middleware
 * 
 * Configures Redis-backed session management for the application.
 * Provides secure, persistent sessions with automatic expiration.
 * Handles session storage, retrieval, and lifecycle management.
 */

const session = require('express-session');
const connectRedis = require('connect-redis');
const { createClient } = require('redis');
const config = require('../../config');
const logger = require('../utils/logger');

// Initialize connect-redis
const RedisStore = connectRedis(session);

let sessionStore;

if (process.env.NODE_ENV === 'test') {
  // Use in-memory store for predictable behaviour in tests
  const MemoryStore = session.MemoryStore;
  sessionStore = new MemoryStore();
} else {
  const redisClient = createClient({
    url: config.redis.url,
    legacyMode: true
  });

  redisClient.connect().catch(err => logger.error('Redis connection error:', err));
  redisClient.on('error', (err) => logger.error('Redis session client error:', err));

  sessionStore = new RedisStore({ client: redisClient });
}

const baseSession = session({
  store: sessionStore,
  secret: config.security.sessionSecret,
  resave: false,
  saveUninitialized: process.env.NODE_ENV === 'test',
  cookie: {
    secure: config.server.env === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  },
  name: 'spotify_swarm_sid'
});

module.exports = (req, res, next) => {
  baseSession(req, res, (err) => {
    if (!err && req.session) {
      req.session.id = req.sessionID;
      if (req.session.cookie) {
        req.session.cookie.secure = process.env.NODE_ENV === 'production';
      }
    }
    next(err);
  });
};
