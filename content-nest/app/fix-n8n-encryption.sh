#!/bin/bash
# Fix n8n encryption key mismatch
# This happens when the ENCRYPTION_KEY in .env doesn't match the key in n8n's config file

echo "🔧 Fixing n8n encryption key mismatch..."
echo ""

# Stop n8n services
echo "1. Stopping n8n services..."
docker compose down n8n n8n-worker

# Remove old config file (requires sudo if not using Docker volumes)
echo "2. Removing old n8n config file..."
echo "   This requires sudo access..."
sudo rm -f /var/lib/docker/volumes/app_n8n_storage/_data/config

if [ $? -eq 0 ]; then
    echo "   ✅ Old config removed"
else
    echo "   ❌ Failed to remove config. Try manually:"
    echo "      sudo rm -f /var/lib/docker/volumes/app_n8n_storage/_data/config"
    exit 1
fi

# Restart n8n
echo "3. Starting n8n with new encryption key..."
docker compose up -d n8n n8n-worker

echo ""
echo "✅ Done! n8n should start with the encryption key from .env"
echo ""
echo "Check logs:"
echo "  docker compose logs -f n8n"
