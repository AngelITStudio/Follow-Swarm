const request = require('supertest');
const app = require('../src/app');
const db = require('../src/database');
const spotifyAuth = require('../src/auth/spotify');

describe('Authentication Routes', () => {
  beforeAll(async () => {
    try {
      await db.connect();
    } catch (error) {
      console.log('DB already connected or connection failed:', error.message);
    }
  }, 30000); // 30 second timeout

  afterAll(async () => {
    try {
      await db.disconnect();
    } catch (error) {
      console.log('DB disconnect error (non-fatal):', error.message);
    }
  }, 30000); // 30 second timeout

  describe('GET /auth/spotify', () => {
    it('should redirect to Spotify OAuth', async () => {
      const response = await request(app)
        .get('/auth/spotify')
        .expect(302);
      
      expect(response.headers.location).toContain('accounts.spotify.com');
      expect(response.headers.location).toContain('client_id');
      expect(response.headers.location).toContain('redirect_uri');
    }, 5000); // 5 second test timeout
  });

  describe('GET /auth/status', () => {
    it('should return unauthenticated when no session', async () => {
      const response = await request(app)
        .get('/auth/status')
        .expect(200);
      
      expect(response.body).toEqual({
        authenticated: false,
        hasValidTokens: false
      });
    });

    it.skip('should return authenticated with user data when logged in', async () => {
      // Test skipped pending proper session hydration support in test environment
    });
  });

  describe('POST /auth/logout', () => {
    it('should require authentication', async () => {
      const response = await request(app)
        .post('/auth/logout')
        .timeout(25000)
        .expect(401);
      
      expect(response.body).toHaveProperty('error');
    }, 30000);
  });

  describe('Spotify OAuth Service', () => {
    describe('Authorization URL', () => {
      it('should generate valid Spotify auth URL', () => {
        const state = 'test_state_123';
        const url = spotifyAuth.getAuthorizationUrl(state);
        
        expect(url).toContain('accounts.spotify.com/authorize');
        expect(url).toContain('response_type=code');
        expect(url).toContain('scope=');
        expect(url).toContain(`state=${state}`);
      });

      it('should include required scopes', () => {
        const state = 'test_state_456';
        const url = spotifyAuth.getAuthorizationUrl(state);
        
        expect(url).toContain('user-follow-modify');
        expect(url).toContain('user-follow-read');
        expect(url).toContain('user-read-private');
        expect(url).toContain('user-read-email');
      });
    });
  });
});