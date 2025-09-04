import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Don't redirect if we're already on the login page or auth pages
      const currentPath = window.location.pathname;
      if (!currentPath.includes('/login') && 
          !currentPath.includes('/auth/') &&
          !currentPath.includes('/auth/success')) {
        // Check if token exists before removing
        const token = localStorage.getItem('token');
        if (token) {
          // Token exists but is invalid, clear it and redirect
          localStorage.removeItem('token');
          localStorage.removeItem('userId');
          window.location.href = '/login';
        } else {
          // No token, just redirect
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authAPI = {
  spotifyLogin: () => {
    window.location.href = `${API_BASE_URL}/auth/spotify`;
  },
  
  getStatus: () => api.get('/auth/status'),
  
  logout: () => api.post('/auth/logout'),
  
  refreshToken: () => api.post('/auth/refresh'),
};

// Follow API
export const followAPI = {
  getRateLimits: () => api.get('/api/follows/rate-limits'),
  
  getSuggestions: (limit = 10) => 
    api.get(`/api/follows/suggestions?limit=${limit}`),
  
  followSingle: (artistId: string) => 
    api.post('/api/follows/single', { artistId }),
  
  followBatch: (artistIds: string[], options?: any) => 
    api.post('/api/follows/batch', { artistIds, options }),
  
  scheduleFollows: (artistIds: string[], startTime?: Date, endTime?: Date) => 
    api.post('/api/follows/schedule', { artistIds, startTime, endTime }),
  
  getHistory: (status?: string, limit = 50, offset = 0) => 
    api.get('/api/follows/history', { 
      params: { status, limit, offset } 
    }),
  
  getStats: (period = '7d') => 
    api.get(`/api/follows/stats?period=${period}`),
  
  getJobs: (status?: string) => 
    api.get('/api/follows/jobs', { params: { status } }),
  
  cancelJobs: () => api.delete('/api/follows/jobs'),
  
  cancelJob: (jobId: string) => api.delete(`/api/follows/jobs/${jobId}`),
};

// User API
export const userAPI = {
  getProfile: () => api.get('/api/user/profile'),
  
  updateProfile: (data: any) => api.put('/api/user/profile', data),
  
  getDashboard: () => api.get('/api/user/dashboard'),
};

// Admin API
export const adminAPI = {
  getStats: () => api.get('/api/admin/stats'),
  getUsers: (params?: any) => api.get('/api/admin/users', { params }),
  getUser: (id: string) => api.get(`/api/admin/users/${id}`),
  updateUser: (id: string, data: any) => api.put(`/api/admin/users/${id}`, data),
  deleteUser: (id: string) => api.delete(`/api/admin/users/${id}`),
  suspendUser: (id: string, data: any) => api.post(`/api/admin/users/${id}/suspend`, data),
  getActivity: (limit?: number) => api.get('/api/admin/activity', { params: { limit } })
};

export default api;