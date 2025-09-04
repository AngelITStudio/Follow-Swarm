#!/bin/bash

# Server Management Script for Follow Swarm
# Manages backend server, frontend dev server, and localtunnel
# Author: Claude
# Date: 2025-09-04

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
BACKEND_PORT=3001
FRONTEND_PORT=5173
TUNNEL_SUBDOMAIN="strong-deer-grow"
TUNNEL_URL="https://${TUNNEL_SUBDOMAIN}.loca.lt"

# Function to print colored output
print_status() {
    echo -e "${BLUE}[STATUS]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Check if a port is in use
check_port() {
    local port=$1
    local service=$2
    
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null ; then
        local pid=$(lsof -t -i:$port)
        print_success "$service is running on port $port (PID: $pid)"
        return 0
    else
        print_warning "$service is NOT running on port $port"
        return 1
    fi
}

# Kill process on a specific port
kill_port() {
    local port=$1
    local service=$2
    
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null ; then
        local pid=$(lsof -t -i:$port)
        print_status "Killing $service on port $port (PID: $pid)..."
        kill -9 $pid 2>/dev/null || true
        sleep 1
        print_success "$service stopped"
    else
        print_status "$service not running on port $port"
    fi
}

# Check tunnel status
check_tunnel() {
    if ps aux | grep -v grep | grep -q "localtunnel.*$TUNNEL_SUBDOMAIN"; then
        print_success "Tunnel is running at $TUNNEL_URL"
        return 0
    else
        print_warning "Tunnel is NOT running"
        return 1
    fi
}

# Kill tunnel
kill_tunnel() {
    local pids=$(ps aux | grep -v grep | grep "localtunnel.*$TUNNEL_SUBDOMAIN" | awk '{print $2}')
    if [ ! -z "$pids" ]; then
        print_status "Killing tunnel processes..."
        echo $pids | xargs kill -9 2>/dev/null || true
        sleep 1
        print_success "Tunnel stopped"
    else
        print_status "Tunnel not running"
    fi
}

# Start backend server
start_backend() {
    print_status "Starting backend server..."
    cd /Volumes/CrucialMedia-4G/GitHub/Follow-Swarm
    npm start > backend.log 2>&1 &
    
    # Wait for server to start
    local count=0
    while [ $count -lt 10 ]; do
        if check_port $BACKEND_PORT "Backend" > /dev/null 2>&1; then
            print_success "Backend server started successfully"
            return 0
        fi
        sleep 1
        count=$((count + 1))
    done
    
    print_error "Backend server failed to start. Check backend.log for details"
    return 1
}

# Start frontend server
start_frontend() {
    print_status "Starting frontend dev server..."
    cd /Volumes/CrucialMedia-4G/GitHub/Follow-Swarm/client
    npm run dev > ../frontend.log 2>&1 &
    
    # Wait for server to start
    local count=0
    while [ $count -lt 10 ]; do
        if check_port $FRONTEND_PORT "Frontend" > /dev/null 2>&1; then
            print_success "Frontend server started successfully"
            return 0
        fi
        sleep 1
        count=$((count + 1))
    done
    
    print_error "Frontend server failed to start. Check frontend.log for details"
    return 1
}

# Start tunnel
start_tunnel() {
    print_status "Starting localtunnel..."
    cd /Volumes/CrucialMedia-4G/GitHub/Follow-Swarm
    npx localtunnel --port $BACKEND_PORT --subdomain $TUNNEL_SUBDOMAIN > tunnel.log 2>&1 &
    
    # Wait for tunnel to establish
    local count=0
    while [ $count -lt 15 ]; do
        if grep -q "your url is:" tunnel.log 2>/dev/null; then
            local url=$(grep "your url is:" tunnel.log | tail -1 | awk '{print $4}')
            print_success "Tunnel established at $url"
            return 0
        fi
        sleep 1
        count=$((count + 1))
    done
    
    print_error "Tunnel failed to start. Check tunnel.log for details"
    return 1
}

# Health check for backend
health_check_backend() {
    local response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$BACKEND_PORT/health)
    if [ "$response" = "200" ]; then
        print_success "Backend health check passed"
        return 0
    else
        print_error "Backend health check failed (HTTP $response)"
        return 1
    fi
}

# Health check for frontend
health_check_frontend() {
    local response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$FRONTEND_PORT/)
    if [ "$response" = "200" ]; then
        print_success "Frontend health check passed"
        return 0
    else
        print_error "Frontend health check failed (HTTP $response)"
        return 1
    fi
}

# Health check for tunnel
health_check_tunnel() {
    local response=$(curl -s -o /dev/null -w "%{http_code}" $TUNNEL_URL/health)
    if [ "$response" = "200" ]; then
        print_success "Tunnel health check passed"
        return 0
    else
        print_error "Tunnel health check failed (HTTP $response)"
        return 1
    fi
}

# Main command processing
case "$1" in
    start)
        echo -e "${BLUE}=== Starting All Services ===${NC}"
        
        # Kill existing processes
        kill_port $BACKEND_PORT "Backend"
        kill_port $FRONTEND_PORT "Frontend"
        kill_tunnel
        
        # Start services
        start_backend
        start_frontend
        start_tunnel
        
        # Run health checks
        echo -e "\n${BLUE}=== Running Health Checks ===${NC}"
        sleep 2
        health_check_backend
        health_check_frontend
        health_check_tunnel
        
        echo -e "\n${GREEN}=== All Services Started ===${NC}"
        echo "Backend: http://localhost:$BACKEND_PORT"
        echo "Frontend: http://localhost:$FRONTEND_PORT"
        echo "Tunnel: $TUNNEL_URL"
        ;;
        
    stop)
        echo -e "${BLUE}=== Stopping All Services ===${NC}"
        kill_port $BACKEND_PORT "Backend"
        kill_port $FRONTEND_PORT "Frontend"
        kill_tunnel
        print_success "All services stopped"
        ;;
        
    restart)
        echo -e "${BLUE}=== Restarting All Services ===${NC}"
        $0 stop
        sleep 2
        $0 start
        ;;
        
    status)
        echo -e "${BLUE}=== Service Status ===${NC}"
        check_port $BACKEND_PORT "Backend"
        check_port $FRONTEND_PORT "Frontend"
        check_tunnel
        
        echo -e "\n${BLUE}=== Health Checks ===${NC}"
        health_check_backend
        health_check_frontend
        health_check_tunnel
        ;;
        
    backend)
        echo -e "${BLUE}=== Managing Backend Server ===${NC}"
        case "$2" in
            start)
                kill_port $BACKEND_PORT "Backend"
                start_backend
                health_check_backend
                ;;
            stop)
                kill_port $BACKEND_PORT "Backend"
                ;;
            restart)
                kill_port $BACKEND_PORT "Backend"
                start_backend
                health_check_backend
                ;;
            status)
                check_port $BACKEND_PORT "Backend"
                health_check_backend
                ;;
            *)
                echo "Usage: $0 backend {start|stop|restart|status}"
                ;;
        esac
        ;;
        
    frontend)
        echo -e "${BLUE}=== Managing Frontend Server ===${NC}"
        case "$2" in
            start)
                kill_port $FRONTEND_PORT "Frontend"
                start_frontend
                health_check_frontend
                ;;
            stop)
                kill_port $FRONTEND_PORT "Frontend"
                ;;
            restart)
                kill_port $FRONTEND_PORT "Frontend"
                start_frontend
                health_check_frontend
                ;;
            status)
                check_port $FRONTEND_PORT "Frontend"
                health_check_frontend
                ;;
            *)
                echo "Usage: $0 frontend {start|stop|restart|status}"
                ;;
        esac
        ;;
        
    tunnel)
        echo -e "${BLUE}=== Managing Tunnel ===${NC}"
        case "$2" in
            start)
                kill_tunnel
                start_tunnel
                health_check_tunnel
                ;;
            stop)
                kill_tunnel
                ;;
            restart)
                kill_tunnel
                start_tunnel
                health_check_tunnel
                ;;
            status)
                check_tunnel
                health_check_tunnel
                ;;
            *)
                echo "Usage: $0 tunnel {start|stop|restart|status}"
                ;;
        esac
        ;;
        
    logs)
        echo -e "${BLUE}=== Viewing Logs ===${NC}"
        case "$2" in
            backend)
                tail -f backend.log
                ;;
            frontend)
                tail -f frontend.log
                ;;
            tunnel)
                tail -f tunnel.log
                ;;
            all)
                tail -f backend.log frontend.log tunnel.log
                ;;
            *)
                echo "Usage: $0 logs {backend|frontend|tunnel|all}"
                ;;
        esac
        ;;
        
    health)
        echo -e "${BLUE}=== Health Check All Services ===${NC}"
        health_check_backend
        health_check_frontend
        health_check_tunnel
        ;;
        
    *)
        echo -e "${BLUE}Follow Swarm Server Management Script${NC}"
        echo ""
        echo "Usage: $0 {command} [options]"
        echo ""
        echo "Commands:"
        echo "  start              - Start all services (backend, frontend, tunnel)"
        echo "  stop               - Stop all services"
        echo "  restart            - Restart all services"
        echo "  status             - Check status of all services"
        echo "  health             - Run health checks on all services"
        echo ""
        echo "Individual service commands:"
        echo "  backend {start|stop|restart|status}  - Manage backend server"
        echo "  frontend {start|stop|restart|status} - Manage frontend server"
        echo "  tunnel {start|stop|restart|status}   - Manage localtunnel"
        echo ""
        echo "Logging:"
        echo "  logs {backend|frontend|tunnel|all}   - View service logs"
        echo ""
        echo "Configuration:"
        echo "  Backend Port: $BACKEND_PORT"
        echo "  Frontend Port: $FRONTEND_PORT"
        echo "  Tunnel URL: $TUNNEL_URL"
        ;;
esac