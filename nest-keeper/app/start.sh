#!/bin/bash
# OAuth Broker Startup Script
# Ensures ALL services including cloudflared are started

set -e

echo "🚀 Starting OAuth Broker services..."
echo ""

# Start all services
docker compose up -d

echo ""
echo "✅ All services started"
echo ""

# Wait a moment for startup
sleep 5

# Show status
echo "📊 Service Status:"
docker compose ps

echo ""
echo "🔗 Public endpoint: https://meta-oauth.rikkcontent.com/health"
echo ""
