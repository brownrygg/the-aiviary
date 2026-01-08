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

# Get BASE_URL from .env if available
if [ -f ".env" ]; then
    BASE_URL=$(grep "^BASE_URL=" .env | cut -d'=' -f2 | tr -d '"' | tr -d "'")
fi
BASE_URL=${BASE_URL:-"https://oauth.theaiviary.com"}

echo ""
echo "🔗 Public endpoint: ${BASE_URL}/health"
echo ""
