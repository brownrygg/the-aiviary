#!/bin/bash
set -e

# ============================================================================
# Nest Keeper - Complete Teardown Script
# ============================================================================
# This script completely removes the Nest Keeper (OAuth Broker) including:
# - All Docker containers
# - All Docker volumes (database, redis)
# - All built Docker images
# - Configuration file (.env)
# ============================================================================

# --- Colors for Output ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# --- Helper Functions ---
print_header() {
    echo -e "\n${BLUE}===============================================================${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}===============================================================${NC}\n"
}

print_success() { echo -e "${GREEN}✅ $1${NC}"; }
print_error() { echo -e "${RED}❌ ERROR: $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠️  WARNING: $1${NC}"; }
print_info() { echo -e "ℹ️  $1"; }

# ============================================================================
# SAFETY CONFIRMATION
# ============================================================================
print_header "Nest Keeper - Complete Teardown"

echo -e "${RED}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${RED}║                    ⚠️  WARNING ⚠️                              ║${NC}"
echo -e "${RED}║                                                               ║${NC}"
echo -e "${RED}║  This will PERMANENTLY DELETE:                                ║${NC}"
echo -e "${RED}║                                                               ║${NC}"
echo -e "${RED}║  • All OAuth broker containers                                ║${NC}"
echo -e "${RED}║  • All database data (client registry, OAuth events)          ║${NC}"
echo -e "${RED}║  • All Redis data                                             ║${NC}"
echo -e "${RED}║  • The .env file with Meta App credentials                    ║${NC}"
echo -e "${RED}║  • All built Docker images                                    ║${NC}"
echo -e "${RED}║                                                               ║${NC}"
echo -e "${RED}║  All registered Aiviary Tree clients will need to             ║${NC}"
echo -e "${RED}║  re-register after you set up Nest Keeper again.              ║${NC}"
echo -e "${RED}║                                                               ║${NC}"
echo -e "${RED}║  THIS ACTION CANNOT BE UNDONE!                                ║${NC}"
echo -e "${RED}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

read -p "Are you absolutely sure you want to proceed? Type 'DELETE EVERYTHING' to confirm: " confirm
if [ "$confirm" != "DELETE EVERYTHING" ]; then
    print_info "Teardown cancelled. No changes were made."
    exit 0
fi

echo ""
print_warning "Proceeding with complete teardown..."
echo ""

# ============================================================================
# 1. STOP AND REMOVE CONTAINERS
# ============================================================================
print_header "Step 1: Stopping and Removing Containers"

if [ -f "docker-compose.yml" ]; then
    print_info "Stopping all containers..."
    docker compose down --remove-orphans 2>&1 | grep -v "variable is not set" || true
    print_success "Containers stopped."
else
    print_warning "No docker-compose.yml found. Skipping container shutdown."
fi

# ============================================================================
# 2. REMOVE VOLUMES
# ============================================================================
print_header "Step 2: Removing Docker Volumes"

print_info "Removing all volumes associated with this stack..."
docker compose down -v 2>&1 | grep -v "variable is not set" || true

# Also try to remove any orphaned volumes with the nest-keeper prefix
print_info "Checking for orphaned volumes..."
ORPHAN_VOLUMES=$(docker volume ls -q | grep -E "^nest-keeper_" || true)
if [ -n "$ORPHAN_VOLUMES" ]; then
    echo "$ORPHAN_VOLUMES" | xargs docker volume rm 2>/dev/null || true
    print_success "Orphaned volumes removed."
else
    print_info "No orphaned volumes found."
fi

print_success "Volumes removed."

# ============================================================================
# 3. REMOVE DOCKER IMAGES
# ============================================================================
print_header "Step 3: Removing Built Docker Images"

print_info "Removing Nest Keeper Docker images..."

# List of image prefixes to remove
IMAGES_TO_REMOVE=(
    "nest-keeper-oauth-broker"
    "app-oauth-broker"
)

for image_prefix in "${IMAGES_TO_REMOVE[@]}"; do
    MATCHING_IMAGES=$(docker images -q "${image_prefix}" 2>/dev/null || true)
    if [ -n "$MATCHING_IMAGES" ]; then
        docker rmi -f $MATCHING_IMAGES 2>/dev/null || true
        print_success "Removed image: ${image_prefix}"
    fi
done

# Remove dangling images
print_info "Removing dangling images..."
docker image prune -f 2>/dev/null || true

print_success "Docker images cleaned up."

# ============================================================================
# 4. REMOVE CONFIGURATION FILES
# ============================================================================
print_header "Step 4: Removing Configuration Files"

# Remove .env file
if [ -f ".env" ]; then
    rm -f .env
    print_success "Removed .env"
else
    print_info "No .env file to remove."
fi

print_success "Configuration files removed."

# ============================================================================
# 5. OPTIONAL: PRUNE DOCKER SYSTEM
# ============================================================================
print_header "Step 5: Docker System Cleanup"

echo ""
read -p "Do you want to run 'docker system prune' to free up additional disk space? (yes/no): " prune_system

if [[ "$prune_system" =~ ^[Yy][Ee][Ss]$ ]]; then
    print_info "Running docker system prune..."
    docker system prune -f
    print_success "Docker system pruned."
else
    print_info "Skipping docker system prune."
fi

# ============================================================================
# 6. SUMMARY
# ============================================================================
print_header "Teardown Complete"

echo -e "${GREEN}Nest Keeper has been completely removed from this system.${NC}"
echo ""
echo "What was removed:"
echo "  ✓ All Docker containers (oauth-broker, postgres, redis, cloudflared)"
echo "  ✓ All Docker volumes (database data)"
echo "  ✓ All built Docker images"
echo "  ✓ Configuration file (.env)"
echo ""
echo "What was preserved:"
echo "  • Source code and docker-compose.yml"
echo "  • .env.example template"
echo "  • database/init.sql schema"
echo ""
echo -e "To set up Nest Keeper again:"
echo -e "  1. ${GREEN}cp .env.example .env${NC}"
echo -e "  2. Edit .env with your Meta App credentials and Cloudflare tunnel token"
echo -e "  3. ${GREEN}./start.sh${NC}"
echo ""
echo "-------------------------------------------------------------------"
echo ""
