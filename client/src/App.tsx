import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { ThemeProvider } from './contexts/ThemeContext';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';
import AdminLayout from './components/AdminLayout';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Follow from './pages/Follow';
import History from './pages/History';
import Settings from './pages/Settings';
import Callback from './pages/Callback';
import AuthSuccess from './pages/AuthSuccess';
import TwoFactor from './pages/TwoFactor';
import CommunityGrowth from './pages/marketing/CommunityGrowth';
import SmartTargeting from './pages/marketing/SmartTargeting';
import SafeCompliant from './pages/marketing/SafeCompliant';
import LightningFast from './pages/marketing/LightningFast';
import AdminDashboard from './pages/admin/AdminDashboard';
import UserManagement from './pages/admin/UserManagement';
import AdminAnalytics from './pages/admin/AdminAnalytics';
import AdminSystem from './pages/admin/AdminSystem';
import AdminSecurity from './pages/admin/AdminSecurity';
import AdminLogs from './pages/admin/AdminLogs';
import { authAPI } from './services/api';

function App() {
  // Check localStorage for token initially
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    // If we have a token, verify it with the backend
    const token = localStorage.getItem('token');
    if (!token) {
      setIsAuthenticated(false);
      setLoading(false);
      return;
    }

    try {
      const response = await authAPI.getStatus();
      setIsAuthenticated(response.data.authenticated);
      // If backend says not authenticated but we have a token, clear it
      if (!response.data.authenticated) {
        localStorage.removeItem('token');
        localStorage.removeItem('userId');
      }
    } catch (error) {
      setIsAuthenticated(false);
      localStorage.removeItem('token');
      localStorage.removeItem('userId');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-spotify-green"></div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <Router>
          <Routes>
          {/* Public routes */}
          <Route path="/login" element={
            isAuthenticated ? <Navigate to="/dashboard" /> : <Login />
          } />
          <Route path="/auth/callback" element={<Callback />} />
          <Route path="/auth/success" element={<AuthSuccess />} />
          <Route path="/auth/2fa" element={<TwoFactor />} />
          
          {/* Marketing pages (public) */}
          <Route path="/features/community-growth" element={<CommunityGrowth />} />
          <Route path="/features/smart-targeting" element={<SmartTargeting />} />
          <Route path="/features/safe-compliant" element={<SafeCompliant />} />
          <Route path="/features/lightning-fast" element={<LightningFast />} />
          
          {/* Protected routes */}
          <Route path="/" element={
            isAuthenticated ? <Layout /> : <Navigate to="/login" />
          }>
            <Route index element={<Navigate to="/dashboard" />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="follow" element={<Follow />} />
            <Route path="history" element={<History />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          
          {/* Admin routes (protected) */}
          <Route path="/admin" element={
            isAuthenticated ? <AdminLayout /> : <Navigate to="/login" />
          }>
            <Route index element={<AdminDashboard />} />
            <Route path="users" element={<UserManagement />} />
            <Route path="analytics" element={<AdminAnalytics />} />
            <Route path="system" element={<AdminSystem />} />
            <Route path="security" element={<AdminSecurity />} />
            <Route path="logs" element={<AdminLogs />} />
          </Route>
        </Routes>
      </Router>
    </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
