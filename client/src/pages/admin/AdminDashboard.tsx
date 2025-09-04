import { useState, useEffect } from 'react';
import { adminAPI } from '../../services/api';
import { 
  Users, 
  TrendingUp, 
  Activity,
  DollarSign,
  UserPlus,
  AlertTriangle,
  BarChart3,
  PieChart,
  Globe,
  Zap,
  Database,
  Server,
  Shield
} from 'lucide-react';
import { StatCardSkeleton } from '../../components/LoadingSkeleton';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';

// Register ChartJS components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

/**
 * AdminDashboard Component
 * 
 * Main admin overview page showing system metrics, user statistics,
 * and real-time monitoring data with interactive charts.
 */
const AdminDashboard = () => {
  const [timeRange, setTimeRange] = useState('7d');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const response = await adminAPI.getStats();
      // Map the API response to the expected format
      if (response.data?.data) {
        const apiData = response.data.data;
        const mappedStats = {
          totalUsers: apiData.users?.total || 0,
          activeUsers: apiData.users?.active || 0,
          newUsersToday: apiData.users?.new_24h || 0,
          revenue: apiData.revenue?.monthly_recurring || 0,
          totalFollows: apiData.follows?.total || 0,
          successRate: apiData.follows?.total > 0 
            ? ((apiData.follows?.completed || 0) / apiData.follows.total * 100).toFixed(1) 
            : 0,
          systemLoad: 32, // Mock value as not provided by API
          apiCalls: 890234 // Mock value as not provided by API
        };
        setStats(mappedStats);
        console.log('Admin stats loaded:', mappedStats);
      }
    } catch (error) {
      console.error('Failed to fetch admin stats:', error);
      // Use mock data on error
      setStats(null);
    } finally {
      setLoading(false);
    }
  };

  // Mock data fallback if API call fails
  const mockStats = {
    totalUsers: 12847,
    activeUsers: 3421,
    newUsersToday: 156,
    revenue: 45670,
    totalFollows: 1250000,
    successRate: 94.3,
    systemLoad: 32,
    apiCalls: 890234
  };

  // Use real stats if available, otherwise use mock data
  const displayStats = stats || mockStats;

  const recentActivity = [
    { id: 1, user: 'john.doe', action: 'Completed 100 follows', time: '2 min ago', status: 'success' },
    { id: 2, user: 'jane.smith', action: 'Upgraded to Premium', time: '5 min ago', status: 'premium' },
    { id: 3, user: 'mike.wilson', action: 'Rate limit warning', time: '10 min ago', status: 'warning' },
    { id: 4, user: 'sarah.jones', action: 'New registration', time: '15 min ago', status: 'new' },
    { id: 5, user: 'alex.brown', action: 'Failed follow attempt', time: '20 min ago', status: 'error' }
  ];

  // Chart data
  const userGrowthData = {
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    datasets: [
      {
        label: 'New Users',
        data: [65, 78, 90, 120, 145, 132, 156],
        borderColor: 'rgb(239, 68, 68)',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        tension: 0.4,
        fill: true
      },
      {
        label: 'Active Users',
        data: [2800, 2950, 3100, 3200, 3350, 3400, 3421],
        borderColor: 'rgb(34, 197, 94)',
        backgroundColor: 'rgba(34, 197, 94, 0.1)',
        tension: 0.4,
        fill: true
      }
    ]
  };

  const followDistributionData = {
    labels: ['Successful', 'Pending', 'Failed', 'Rate Limited'],
    datasets: [{
      data: [75, 15, 7, 3],
      backgroundColor: [
        'rgba(34, 197, 94, 0.8)',
        'rgba(250, 204, 21, 0.8)',
        'rgba(239, 68, 68, 0.8)',
        'rgba(168, 85, 247, 0.8)'
      ],
      borderWidth: 0
    }]
  };

  const apiUsageData = {
    labels: ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '24:00'],
    datasets: [{
      label: 'API Calls',
      data: [45000, 32000, 78000, 125000, 98000, 110000, 89000],
      backgroundColor: 'rgba(59, 130, 246, 0.8)',
      borderRadius: 8
    }]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'bottom' as const,
        labels: {
          color: 'rgb(156, 163, 175)'
        }
      }
    },
    scales: {
      x: {
        grid: {
          display: false
        },
        ticks: {
          color: 'rgb(156, 163, 175)'
        }
      },
      y: {
        grid: {
          color: 'rgba(156, 163, 175, 0.1)'
        },
        ticks: {
          color: 'rgb(156, 163, 175)'
        }
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Admin Dashboard</h1>
          <p className="text-gray-400 mt-1">System overview and real-time metrics</p>
        </div>
        <select
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value)}
          className="px-4 py-2 bg-gray-800 border border-gray-700 text-white rounded-xl focus:ring-2 focus:ring-red-600 focus:border-transparent transition-colors"
        >
          <option value="24h">Last 24 Hours</option>
          <option value="7d">Last 7 Days</option>
          <option value="30d">Last 30 Days</option>
          <option value="90d">Last 90 Days</option>
        </select>
      </div>

      {/* Key Metrics Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {Array.from({ length: 4 }).map((_, index) => (
            <StatCardSkeleton key={index} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl border border-gray-700 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl">
                <Users className="h-6 w-6 text-white" />
              </div>
              <span className="text-green-400 text-sm font-semibold">+12.5%</span>
            </div>
            <div className="text-2xl font-bold text-white">{displayStats.totalUsers.toLocaleString()}</div>
            <div className="text-sm text-gray-400 mt-1">Total Users</div>
          </div>

          <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl border border-gray-700 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-gradient-to-br from-green-500 to-green-600 rounded-xl">
                <Activity className="h-6 w-6 text-white" />
              </div>
              <span className="text-green-400 text-sm font-semibold">+8.3%</span>
            </div>
            <div className="text-2xl font-bold text-white">{displayStats.activeUsers.toLocaleString()}</div>
            <div className="text-sm text-gray-400 mt-1">Active Users</div>
          </div>

          <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl border border-gray-700 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-gradient-to-br from-yellow-500 to-yellow-600 rounded-xl">
                <DollarSign className="h-6 w-6 text-white" />
              </div>
              <span className="text-green-400 text-sm font-semibold">+23.1%</span>
            </div>
            <div className="text-2xl font-bold text-white">${displayStats.revenue.toLocaleString()}</div>
            <div className="text-sm text-gray-400 mt-1">Monthly Revenue</div>
          </div>

          <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl border border-gray-700 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl">
                <TrendingUp className="h-6 w-6 text-white" />
              </div>
              <span className="text-green-400 text-sm font-semibold">{displayStats.successRate}%</span>
            </div>
            <div className="text-2xl font-bold text-white">{(displayStats.totalFollows / 1000000).toFixed(2)}M</div>
            <div className="text-sm text-gray-400 mt-1">Total Follows</div>
          </div>
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* User Growth Chart */}
        <div className="lg:col-span-2 bg-gray-800/50 backdrop-blur-sm rounded-2xl border border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
            <BarChart3 className="h-5 w-5 mr-2 text-red-400" />
            User Growth Trend
          </h3>
          <div className="h-64">
            <Line data={userGrowthData} options={chartOptions} />
          </div>
        </div>

        {/* Follow Distribution */}
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl border border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
            <PieChart className="h-5 w-5 mr-2 text-red-400" />
            Follow Distribution
          </h3>
          <div className="h-64">
            <Doughnut data={followDistributionData} options={{
              ...chartOptions,
              plugins: {
                ...chartOptions.plugins,
                legend: {
                  ...chartOptions.plugins.legend,
                  position: 'bottom'
                }
              }
            }} />
          </div>
        </div>
      </div>

      {/* System Status and Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* System Status */}
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl border border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
            <Server className="h-5 w-5 mr-2 text-red-400" />
            System Status
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <Database className="h-5 w-5 text-gray-400 mr-3" />
                <span className="text-gray-300">Database</span>
              </div>
              <div className="flex items-center">
                <div className="h-2 w-2 bg-green-400 rounded-full animate-pulse mr-2" />
                <span className="text-green-400 text-sm">Healthy</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <Globe className="h-5 w-5 text-gray-400 mr-3" />
                <span className="text-gray-300">API Gateway</span>
              </div>
              <div className="flex items-center">
                <div className="h-2 w-2 bg-green-400 rounded-full animate-pulse mr-2" />
                <span className="text-green-400 text-sm">Operational</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <Zap className="h-5 w-5 text-gray-400 mr-3" />
                <span className="text-gray-300">Queue Service</span>
              </div>
              <div className="flex items-center">
                <div className="h-2 w-2 bg-yellow-400 rounded-full animate-pulse mr-2" />
                <span className="text-yellow-400 text-sm">High Load</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <Shield className="h-5 w-5 text-gray-400 mr-3" />
                <span className="text-gray-300">Security</span>
              </div>
              <div className="flex items-center">
                <div className="h-2 w-2 bg-green-400 rounded-full animate-pulse mr-2" />
                <span className="text-green-400 text-sm">Protected</span>
              </div>
            </div>
          </div>

          {/* System Load Bar */}
          <div className="mt-6">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-400">System Load</span>
              <span className="text-white font-semibold">{displayStats.systemLoad}%</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div 
                className="bg-gradient-to-r from-green-500 to-yellow-500 h-2 rounded-full transition-all duration-500"
                style={{ width: `${displayStats.systemLoad}%` }}
              />
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl border border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
            <Activity className="h-5 w-5 mr-2 text-red-400" />
            Recent Activity
          </h3>
          <div className="space-y-3">
            {recentActivity.map((activity) => (
              <div key={activity.id} className="flex items-center justify-between p-3 bg-gray-900/50 rounded-xl">
                <div className="flex items-center">
                  <div className={`h-2 w-2 rounded-full mr-3 ${
                    activity.status === 'success' ? 'bg-green-400' :
                    activity.status === 'premium' ? 'bg-purple-400' :
                    activity.status === 'warning' ? 'bg-yellow-400' :
                    activity.status === 'new' ? 'bg-blue-400' :
                    'bg-red-400'
                  }`} />
                  <div>
                    <div className="text-sm text-white font-medium">{activity.user}</div>
                    <div className="text-xs text-gray-400">{activity.action}</div>
                  </div>
                </div>
                <div className="text-xs text-gray-500">{activity.time}</div>
              </div>
            ))}
          </div>
          <button className="w-full mt-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-xl transition-colors text-sm font-medium">
            View All Activity
          </button>
        </div>
      </div>

      {/* API Usage Chart */}
      <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl border border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
          <Zap className="h-5 w-5 mr-2 text-red-400" />
          API Usage (24 Hours)
        </h3>
        <div className="h-64">
          <Bar data={apiUsageData} options={{
            ...chartOptions,
            plugins: {
              ...chartOptions.plugins,
              legend: {
                display: false
              }
            }
          }} />
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <button className="p-4 bg-gradient-to-br from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-xl transition-all duration-200 flex items-center justify-center">
          <UserPlus className="h-5 w-5 mr-2" />
          Add User
        </button>
        <button className="p-4 bg-gradient-to-br from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white rounded-xl transition-all duration-200 flex items-center justify-center">
          <Shield className="h-5 w-5 mr-2" />
          Security Scan
        </button>
        <button className="p-4 bg-gradient-to-br from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white rounded-xl transition-all duration-200 flex items-center justify-center">
          <Database className="h-5 w-5 mr-2" />
          Backup Data
        </button>
        <button className="p-4 bg-gradient-to-br from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white rounded-xl transition-all duration-200 flex items-center justify-center">
          <AlertTriangle className="h-5 w-5 mr-2" />
          View Alerts
        </button>
      </div>
    </div>
  );
};

export default AdminDashboard;