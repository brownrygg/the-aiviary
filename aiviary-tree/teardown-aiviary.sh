#!/bin/bash
set -e

# ============================================================================
# Content Aiviary - Complete Teardown Script
# ============================================================================
# This script completely removes the Aiviary Tree installation including:
# - All Docker containers
# - All Docker volumes (databases, n8n data, redis, etc.)
# - All built Docker images
# - Configuration files (.env)
# - Generated certificates
# - Optionally deregisters from the OAuth broker
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
print_header "🗑️  Aiviary Tree - Complete Teardown"

echo -e "${RED}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${RED}║                    ⚠️  WARNING ⚠️                              ║${NC}"
echo -e "${RED}║                                                               ║${NC}"
echo -e "${RED}║  This will PERMANENTLY DELETE:                                ║${NC}"
echo -e "${RED}║                                                               ║${NC}"
echo -e "${RED}║  • All Docker containers for this stack                       ║${NC}"
echo -e "${RED}║  • All database data (PostgreSQL volumes)                     ║${NC}"
echo -e "${RED}║  • All n8n workflows and credentials                          ║${NC}"
echo -e "${RED}║  • All Redis data                                             ║${NC}"
echo -e "${RED}║  • All synced Meta/Instagram analytics data                   ║${NC}"
echo -e "${RED}║  • All user accounts and chat history                         ║${NC}"
echo -e "${RED}║  • The .env file with all API keys and secrets                ║${NC}"
echo -e "${RED}║  • All built Docker images                                    ║${NC}"
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
# 1. CAPTURE CLIENT INFO BEFORE DELETION
# ============================================================================
print_header "Step 1: Capturing Configuration"

CLIENT_ID=""
OAUTH_BROKER_URL="https://oauth.theaiviary.com"

if [ -f "app/.env" ]; then
    CLIENT_ID=$(grep "^CLIENT_ID=" app/.env | cut -d'=' -f2 | tr -d '"' | tr -d "'")
    print_info "Found client ID: ${CLIENT_ID}"
else
    print_warning "No .env file found. Cannot determine client ID for broker deregistration."
fi

# ============================================================================
# 2. STOP AND REMOVE CONTAINERS
# ============================================================================
print_header "Step 2: Stopping and Removing Containers"

if [ -f "app/docker-compose.yml" ]; then
    print_info "Stopping all containers..."
    (cd app && docker compose down --remove-orphans 2>&1 | grep -v "variable is not set" || true)
    print_success "Containers stopped."
else
    print_warning "No docker-compose.yml found. Skipping container shutdown."
fi

# ============================================================================
# 3. REMOVE VOLUMES
# ============================================================================
print_header "Step 3: Removing Docker Volumes"

print_info "Removing all volumes associated with this stack..."
(cd app && docker compose down -v 2>&1 | grep -v "variable is not set" || true)

# Also try to remove any orphaned volumes with the app prefix
print_info "Checking for orphaned volumes..."
ORPHAN_VOLUMES=$(docker volume ls -q | grep -E "^app_" || true)
if [ -n "$ORPHAN_VOLUMES" ]; then
    echo "$ORPHAN_VOLUMES" | xargs docker volume rm 2>/dev/null || true
    print_success "Orphaned volumes removed."
else
    print_info "No orphaned volumes found."
fi

print_success "Volumes removed."

# ============================================================================
# 4. REMOVE DOCKER IMAGES
# ============================================================================
print_header "Step 4: Removing Built Docker Images"

print_info "Removing Aiviary-related Docker images..."

# List of image prefixes to remove
IMAGES_TO_REMOVE=(
    "app-aiviary-chat-backend"
    "app-aiviary-chat-frontend"
    "app-aiviary-connect"
    "app-analytics-agent"
    "app-meta-sync-worker"
    "app-meta-enrichment-worker"
    "app-meta-ads-mcp"
    "app-instagram-analytics-mcp"
    "app-meta-ad-library-mcp"
)

for image_prefix in "${IMAGES_TO_REMOVE[@]}"; do
    MATCHING_IMAGES=$(docker images -q "${image_prefix}" 2>/dev/null || true)
    if [ -n "$MATCHING_IMAGES" ]; then
        docker rmi -f $MATCHING_IMAGES 2>/dev/null || true
        print_success "Removed image: ${image_prefix}"
    fi
done

# Also remove any dangling images from the build
print_info "Removing dangling images..."
docker image prune -f 2>/dev/null || true

print_success "Docker images cleaned up."

# ============================================================================
# 5. REMOVE CONFIGURATION FILES
# ============================================================================
print_header "Step 5: Removing Configuration Files"

# Remove .env file
if [ -f "app/.env" ]; then
    rm -f app/.env
    print_success "Removed app/.env"
else
    print_info "No .env file to remove."
fi

# Remove generated SSL certificates
if [ -d "app/shared/nginx/certs" ]; then
    rm -f app/shared/nginx/certs/*.pem 2>/dev/null || true
    print_success "Removed SSL certificates."
fi

# Remove any cached credentials
if [ -d "app/shared/credentials" ]; then
    # Don't remove the service-account.json as it's typically needed for setup
    # Just note that it exists
    print_info "Note: app/shared/credentials/ directory preserved (may contain service account files)."
fi

print_success "Configuration files removed."

# ============================================================================
# 6. DEREGISTER FROM OAUTH BROKER (OPTIONAL)
# ============================================================================
print_header "Step 6: OAuth Broker Deregistration"

if [ -n "$CLIENT_ID" ]; then
    echo ""
    read -p "Do you want to deregister '${CLIENT_ID}' from the OAuth broker? (yes/no): " deregister

    if [[ "$deregister" =~ ^[Yy][Ee][Ss]$ ]]; then
        print_info "Attempting to deregister from OAuth broker..."

        set +e  # Temporarily disable exit on error
        DEREGISTER_RESPONSE=$(curl -s -w "\n%{http_code}" -X DELETE "${OAUTH_BROKER_URL}/admin/clients/${CLIENT_ID}" 2>&1)
        CURL_EXIT_CODE=$?
        set -e

        if [ $CURL_EXIT_CODE -ne 0 ]; then
            print_warning "Could not connect to OAuth broker. Manual deregistration may be needed."
            print_info "To manually deregister, run:"
            echo -e "  ${GREEN}curl -X DELETE ${OAUTH_BROKER_URL}/admin/clients/${CLIENT_ID}${NC}"
        else
            HTTP_CODE=$(echo "$DEREGISTER_RESPONSE" | tail -n 1)
            if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "204" ]; then
                print_success "Successfully deregistered '${CLIENT_ID}' from OAuth broker."
            elif [ "$HTTP_CODE" = "404" ]; then
                print_info "Client '${CLIENT_ID}' was not found in the broker (already removed or never registered)."
            else
                print_warning "Unexpected response from broker (HTTP ${HTTP_CODE}). Manual check recommended."
            fi
        fi
    else
        print_info "Skipping broker deregistration."
        print_info "Note: The client '${CLIENT_ID}' may still be registered at ${OAUTH_BROKER_URL}"
    fi
else
    print_info "No client ID found. Skipping broker deregistration."
fi

# ============================================================================
# 7. OPTIONAL: PRUNE DOCKER SYSTEM
# ============================================================================
print_header "Step 7: Docker System Cleanup"

echo ""
read -p "Do you want to run 'docker system prune' to free up additional disk space? (yes/no): " prune_system

if [[ "$prune_system" =~ ^[Yy][Ee][Ss]$ ]]; then
    print_info "Running docker system prune..."
    docker system prune -f
    print_success "Docker system pruned."

    echo ""
    read -p "Also remove unused Docker volumes system-wide? (yes/no): " prune_volumes
    if [[ "$prune_volumes" =~ ^[Yy][Ee][Ss]$ ]]; then
        docker volume prune -f
        print_success "Unused volumes pruned."
    fi
else
    print_info "Skipping docker system prune."
fi

# ============================================================================
# 8. SUMMARY
# ============================================================================
print_header "🧹 Teardown Complete"

echo -e "${GREEN}The Aiviary Tree has been completely removed from this VM.${NC}"
echo ""
echo "What was removed:"
echo "  ✓ All Docker containers"
echo "  ✓ All Docker volumes (database data, n8n workflows, etc.)"
echo "  ✓ All built Docker images"
echo "  ✓ Configuration file (app/.env)"
echo "  ✓ Generated certificates"
if [[ "$deregister" =~ ^[Yy][Ee][Ss]$ ]]; then
    echo "  ✓ OAuth broker registration"
fi
echo ""
echo "What was preserved:"
echo "  • Source code and docker-compose.yml"
echo "  • app/.env.example template"
echo "  • Service account credentials (if any)"
echo ""
echo -e "To set up the Aiviary again, run: ${GREEN}./setup-aiviary.sh${NC}"
echo ""
echo "-------------------------------------------------------------------"
echo ""
