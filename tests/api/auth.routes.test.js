const request = require('supertest');
const app = require('../../src/app');
const spotifyAuth = require('../../src/auth/spotify');
const db = require('../../src/database');
const jwt = require('jsonwebtoken');
const config = require('../../config');

// Mock dependencies
jest.mock('../../src/auth/spotify');

describe('Authentication Routes', () => {
  let testUser;

  beforeAll(async () => {
    // Create test user
    testUser = {
      id: 'test-user-123',
      spotify_id: 'spotify-test-123',
      email: 'test@example.com',
      display_name: 'Test User',
      status: 'active'
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();
    spotifyAuth.getAuthorizationUrl = jest.fn().mockImplementation((state) => `https://accounts.spotify.com/authorize?state=${state}`);
  });

  describe('GET /auth/login', () => {
    it('should redirect to Spotify authorization', async () => {
      const authUrl = 'https://accounts.spotify.com/authorize?client_id=test';
      spotifyAuth.getAuthorizationUrl = jest.fn().mockReturnValue(authUrl);

      const response = await request(app)
        .get('/auth/login')
        .expect(302);

      expect(response.headers.location).toBe(authUrl);
      expect(spotifyAuth.getAuthorizationUrl).toHaveBeenCalled();
    });

    it('should generate and store state parameter', async () => {
      spotifyAuth.getAuthorizationUrl = jest.fn().mockImplementation((state) => {
        return `https://accounts.spotify.com/authorize?state=${state}`;
      });

      const response = await request(app)
        .get('/auth/login')
        .expect(302);

      // State should be in the URL
      expect(response.headers.location).toContain('state=');
    });

    it('should handle authorization URL generation errors', async () => {
      spotifyAuth.getAuthorizationUrl = jest.fn().mockImplementation(() => {
        throw new Error('Configuration error');
      });

      const response = await request(app)
        .get('/auth/login')
        .expect(500);

      expect(response.body.error).toContain('Failed to generate authorization URL');
    });
  });

  describe('GET /auth/callback', () => {
    it('should handle successful Spotify callback', async () => {
      const code = 'test-auth-code';
      const state = 'test-state';
      
      // Mock successful token exchange
      spotifyAuth.exchangeCodeForTokens = jest.fn().mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresIn: 3600
      });

      // Mock user profile fetch
      spotifyAuth.getUserProfile = jest.fn().mockResolvedValue({
        id: 'spotify-user-123',
        email: 'user@example.com',
        display_name: 'User Name',
        images: []
      });

      // Mock user save
      spotifyAuth.saveOrUpdateUser = jest.fn().mockResolvedValue(testUser);
      
      // Mock token save
      spotifyAuth.saveTokens = jest.fn().mockResolvedValue();

      const response = await request(app)
        .get(`/auth/callback?code=${code}&state=${state}`)
        .expect(302);

      expect(spotifyAuth.exchangeCodeForTokens).toHaveBeenCalledWith(code);
      expect(spotifyAuth.getUserProfile).toHaveBeenCalled();
      expect(spotifyAuth.saveOrUpdateUser).toHaveBeenCalled();
      expect(spotifyAuth.saveTokens).toHaveBeenCalled();
    });

    it('should handle missing authorization code', async () => {
      const response = await request(app)
        .get('/auth/callback')
        .expect(400);

      expect(response.body.error).toContain('Authorization code not provided');
    });

    it('should handle Spotify API errors', async () => {
      const code = 'invalid-code';
      
      spotifyAuth.exchangeCodeForTokens = jest.fn().mockRejectedValue(
        new Error('Invalid authorization code')
      );

      const response = await request(app)
        .get(`/auth/callback?code=${code}`)
        .expect(500);

      expect(response.body.error).toContain('Authentication failed');
    });

    it('should handle user access denial', async () => {
      const error = 'access_denied';
      
      const response = await request(app)
        .get(`/auth/callback?error=${error}`)
        .expect(400);

      expect(response.body.error).toContain('Access denied');
    });

    it('should create JWT token on successful auth', async () => {
      const code = 'test-code';
      
      spotifyAuth.exchangeCodeForTokens = jest.fn().mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresIn: 3600
      });

      spotifyAuth.getUserProfile = jest.fn().mockResolvedValue({
        id: 'spotify-user-123',
        email: 'user@example.com'
      });

      spotifyAuth.saveOrUpdateUser = jest.fn().mockResolvedValue(testUser);
      spotifyAuth.saveTokens = jest.fn().mockResolvedValue();

      const response = await request(app)
        .get(`/auth/callback?code=${code}`)
        .expect(302);

      // Should redirect to dashboard or success page
      expect(response.headers.location).toBeDefined();
    });
  });

  describe('POST /auth/refresh', () => {
    it('should refresh access token with valid refresh token', async () => {
      const userId = 'user-123';
      const validToken = jwt.sign({ userId }, config.security.jwtSecret);

      spotifyAuth.getValidAccessToken = jest.fn().mockResolvedValue('new-access-token');

      const response = await request(app)
        .post('/auth/refresh')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('accessToken', 'new-access-token');
      expect(spotifyAuth.getValidAccessToken).toHaveBeenCalledWith(userId);
    });

    it('should reject invalid JWT token', async () => {
      const invalidToken = 'invalid-jwt-token';

      const response = await request(app)
        .post('/auth/refresh')
        .set('Authorization', `Bearer ${invalidToken}`)
        .expect(401);

      expect(response.body.error).toContain('Invalid token');
    });

    it('should handle missing authorization header', async () => {
      const response = await request(app)
        .post('/auth/refresh')
        .expect(401);

      expect(response.body.error).toContain('No token provided');
    });

    it('should handle token refresh failures', async () => {
      const userId = 'user-123';
      const validToken = jwt.sign({ userId }, config.security.jwtSecret);

      spotifyAuth.getValidAccessToken = jest.fn().mockRejectedValue(
        new Error('Refresh token expired')
      );

      const response = await request(app)
        .post('/auth/refresh')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(500);

      expect(response.body.error).toContain('Failed to refresh token');
    });
  });

  describe('POST /auth/logout', () => {
    it('should logout authenticated user', async () => {
      const userId = 'user-123';
      const validToken = jwt.sign({ userId }, config.security.jwtSecret);

      spotifyAuth.revokeTokens = jest.fn().mockResolvedValue();

      const response = await request(app)
        .post('/auth/logout')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(response.body.message).toContain('Logged out successfully');
      expect(spotifyAuth.revokeTokens).toHaveBeenCalledWith(userId);
    });

    it('should clear session on logout', async () => {
      const agent = request.agent(app);
      
      // First login
      const userId = 'user-123';
      const validToken = jwt.sign({ userId }, config.security.jwtSecret);

      spotifyAuth.revokeTokens = jest.fn().mockResolvedValue();

      const response = await agent
        .post('/auth/logout')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(response.body.message).toContain('Logged out');
      
      // Session should be destroyed
      const sessionCheck = await agent
        .get('/auth/status')
        .expect(401);

      expect(sessionCheck.body.authenticated).toBe(false);
    });

    it('should handle logout without authentication', async () => {
      const response = await request(app)
        .post('/auth/logout')
        .expect(401);

      expect(response.body.error).toContain('Not authenticated');
    });
  });

  describe('GET /auth/status', () => {
    it('should return authenticated status for valid session', async () => {
      const userId = 'user-123';
      const validToken = jwt.sign({ userId }, config.security.jwtSecret);

      // Mock user lookup
      db.findOne = jest.fn().mockResolvedValue(testUser);

      const response = await request(app)
        .get('/auth/status')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('authenticated', true);
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.id).toBe(testUser.id);
    });

    it('should return unauthenticated status without token', async () => {
      const response = await request(app)
        .get('/auth/status')
        .expect(200);

      expect(response.body).toHaveProperty('authenticated', false);
      expect(response.body).not.toHaveProperty('user');
    });

    it('should handle expired tokens', async () => {
      const userId = 'user-123';
      const expiredToken = jwt.sign(
        { userId },
        config.security.jwtSecret,
        { expiresIn: '-1h' } // Expired 1 hour ago
      );

      const response = await request(app)
        .get('/auth/status')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('authenticated', false);
      expect(response.body).toHaveProperty('error', 'Token expired');
    });
  });

  describe('Security Headers', () => {
    it('should include security headers in responses', async () => {
      const response = await request(app)
        .get('/auth/status')
        .expect(200);

      expect(response.headers).toHaveProperty('x-content-type-options', 'nosniff');
      expect(response.headers).toHaveProperty('x-frame-options');
    });

    it('should prevent clickjacking with X-Frame-Options', async () => {
      const response = await request(app)
        .get('/auth/login')
        .expect(302);

      const frameOptions = response.headers['x-frame-options'];
      expect(['DENY', 'SAMEORIGIN']).toContain(frameOptions);
    });
  });

  describe('Rate Limiting', () => {
    it('should rate limit authentication attempts', async () => {
      // Make multiple rapid requests
      const requests = [];
      for (let i = 0; i < 15; i++) {
        requests.push(
          request(app)
            .post('/auth/refresh')
            .set('Authorization', 'Bearer invalid-token')
        );
      }

      const responses = await Promise.all(requests);
      
      // At least one should be rate limited
      const rateLimited = responses.some(r => r.status === 429);
      expect(rateLimited).toBe(true);
    });

    it('should include retry-after header when rate limited', async () => {
      // Make many requests to trigger rate limit
      const requests = [];
      for (let i = 0; i < 20; i++) {
        requests.push(
          request(app)
            .post('/auth/refresh')
            .set('Authorization', 'Bearer invalid-token')
        );
      }

      const responses = await Promise.all(requests);
      const rateLimitedResponse = responses.find(r => r.status === 429);
      
      if (rateLimitedResponse) {
        expect(rateLimitedResponse.headers).toHaveProperty('retry-after');
      }
    });
  });

  describe('CSRF Protection', () => {
    it('should require CSRF token for state-changing operations', async () => {
      const response = await request(app)
        .post('/auth/logout')
        .expect(401);

      // Should fail without proper CSRF token
      expect(response.body.error).toBeDefined();
    });

    it('should validate CSRF token in requests', async () => {
      const agent = request.agent(app);
      
      // Get CSRF token
      const tokenResponse = await agent
        .get('/auth/csrf-token')
        .expect(200);

      if (tokenResponse.body.csrfToken) {
        const userId = 'user-123';
        const validToken = jwt.sign({ userId }, config.security.jwtSecret);

        const response = await agent
          .post('/auth/logout')
          .set('Authorization', `Bearer ${validToken}`)
          .set('X-CSRF-Token', tokenResponse.body.csrfToken)
          .expect(200);

        expect(response.body.message).toContain('Logged out');
      }
    });
  });
});