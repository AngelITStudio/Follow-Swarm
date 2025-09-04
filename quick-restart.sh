#!/bin/bash

# Quick Restart Script - Restarts backend and tunnel only
# For use during development when making backend changes

echo "🔄 Quick Restart - Backend & Tunnel"
echo "================================="

# Kill backend
echo "⏹️  Stopping backend..."
kill $(lsof -t -i:3001) 2>/dev/null || true
sleep 1

# Kill tunnel
echo "⏹️  Stopping tunnel..."
ps aux | grep -v grep | grep "localtunnel.*strong-deer-grow" | awk '{print $2}' | xargs kill -9 2>/dev/null || true
sleep 1

# Start backend
echo "▶️  Starting backend..."
npm start > backend.log 2>&1 &

# Wait for backend
sleep 3

# Start tunnel
echo "▶️  Starting tunnel..."
npx localtunnel --port 3001 --subdomain strong-deer-grow > tunnel.log 2>&1 &

# Wait for tunnel
echo "⏳ Waiting for tunnel..."
sleep 5

# Check status
echo ""
echo "✅ Services Restarted:"
echo "  Backend: http://localhost:3001"
echo "  Tunnel: https://strong-deer-grow.loca.lt"
echo ""
echo "📝 Logs available at:"
echo "  backend.log"
echo "  tunnel.log"