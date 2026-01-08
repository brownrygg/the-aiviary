#!/bin/bash
set -e

# ============================================================================
# Content Aiviary - Automated Setup Script
# ============================================================================
# This script automates the complete setup of the Content Aiviary stack,
# including dependency checks, secure key generation, Docker service
# deployment, and initiation of the historical data sync.
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
# 1. PREREQUISITE CHECK
# ============================================================================
print_header "Step 1: Checking Prerequisites"

check_dependency() {
    if ! command -v $1 &> /dev/null; then
        print_error "'$1' is not installed, but is required to continue."
        exit 1
    fi
    print_success "$1 is installed."
}

check_dependency "docker"
check_dependency "openssl"
check_dependency "curl"
print_info "Note: 'docker-compose' is also required (usually installed with Docker)."
echo ""

# ============================================================================
# 2. SAFETY CHECK & CLEANUP
# ============================================================================
print_header "Step 2: Checking for Existing Configurations"

if [ -f "app/.env" ] || [ ! -z "$(cd app && docker compose ps -q 2>/dev/null)" ]; then
    print_warning "An existing .env file or running containers were found."
    read -p "Do you want to perform a clean shutdown and remove all existing data (including database volumes)? This is recommended for a fresh start. (yes/no): " confirm_cleanup
    if [[ "$confirm_cleanup" =~ ^[Yy][Ee][Ss]$ ]]; then
        print_info "Shutting down and removing existing containers and volumes..."
        # Change to app directory so docker compose finds the .env file
        (cd app && docker compose down -v 2>&1 | grep -v "variable is not set" || true)

        print_info "Removing configuration files..."
        rm -f app/.env

        print_info "Removing generated SSL certificates..."
        rm -f app/nginx/certs/*.pem

        print_success "Cleanup complete. All containers, volumes, and configuration files removed."
    else
        print_error "Setup cannot proceed with an existing configuration. Please back up and remove the 'app/.env' file and run 'docker compose down -v' manually."
        exit 1
    fi
fi

# ============================================================================
# 3. GATHER USER CONFIGURATION
# ============================================================================
print_header "Step 3: Gathering Configuration Details"

# --- Get Required Inputs ---
read -p "Enter client name (e.g., tanya): " CLIENT_NAME
read -p "Enter your Cloudflare Tunnel Token: " CLOUDFLARE_TUNNEL_TOKEN
read -p "Enter your Google API Key (for embeddings): " GOOGLE_API_KEY
read -p "Enter your Anthropic API Key (for the agent's brain): " ANTHROPIC_API_KEY

# --- Auto-construct values ---
CLIENT_ID="${CLIENT_NAME}"
DOMAIN="${CLIENT_NAME}.theaiviary.com"
OAUTH_BROKER_URL="https://oauth.theaiviary.com"

# --- Clean up inputs (remove trailing whitespace) ---
CLIENT_NAME=$(echo "$CLIENT_NAME" | sed 's/[[:space:]]*$//')
CLIENT_ID=$(echo "$CLIENT_ID" | sed 's/[[:space:]]*$//')

# --- Validate Inputs ---
if [ -z "$CLIENT_NAME" ] || [ -z "$CLOUDFLARE_TUNNEL_TOKEN" ] || [ -z "$GOOGLE_API_KEY" ] || [ -z "$ANTHROPIC_API_KEY" ]; then
    print_error "All fields are required. Please run the script again."
    exit 1
fi

# --- Show what will be configured ---
echo ""
print_info "Configuration Summary:"
print_info "  Client ID: ${CLIENT_ID}"
print_info "  Domain: ${DOMAIN}"
print_info "  OAuth Broker: ${OAUTH_BROKER_URL}"
echo ""

print_success "All configuration details received."

# ============================================================================
# 4. GENERATE .ENV FILE
# ============================================================================
print_header "Step 4: Generating Secure Configuration File"

print_info "Generating secure keys and creating 'app/.env' file..."

# --- Generate Secure Secrets ---
VM_API_KEY=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 32)
POSTGRES_NON_ROOT_PASSWORD=$(openssl rand -hex 32)
JWT_SECRET_KEY=$(openssl rand -hex 32)

# --- Create .env from .env.example and substitute values ---
cp app/.env.example app/.env

# Use sed to replace placeholder values.
# The | separator is used to avoid issues with special characters in variables.
sed -i "s|CLIENT_ID=.*|CLIENT_ID=${CLIENT_ID}|" app/.env
sed -i "s|VM_API_KEY=.*|VM_API_KEY=${VM_API_KEY}|" app/.env
sed -i "s|DOMAIN=.*|DOMAIN=${DOMAIN}|" app/.env
sed -i "s|N8N_DOMAIN=.*|N8N_DOMAIN=${DOMAIN}|" app/.env
sed -i "s|POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${POSTGRES_PASSWORD}|" app/.env
sed -i "s|POSTGRES_NON_ROOT_PASSWORD=.*|POSTGRES_NON_ROOT_PASSWORD=${POSTGRES_NON_ROOT_PASSWORD}|" app/.env
sed -i "s|ENCRYPTION_KEY=.*|ENCRYPTION_KEY=${ENCRYPTION_KEY}|" app/.env
sed -i "s|JWT_SECRET_KEY=.*|JWT_SECRET_KEY=${JWT_SECRET_KEY}|" app/.env
sed -i "s|GOOGLE_API_KEY=.*|GOOGLE_API_KEY=${GOOGLE_API_KEY}|" app/.env
sed -i "s|ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}|" app/.env
sed -i "s|CLOUDFLARE_TUNNEL_TOKEN=.*|CLOUDFLARE_TUNNEL_TOKEN=${CLOUDFLARE_TUNNEL_TOKEN}|" app/.env
sed -i "s|CLIENT_ID_BROKER=.*|CLIENT_ID_BROKER=${CLIENT_ID}|" app/.env
sed -i "s|COMPOSE_PROJECT_NAME=.*|COMPOSE_PROJECT_NAME=aiviary-${CLIENT_ID}|" app/.env

print_success "'app/.env' file has been securely configured."

# --- Update onboarding page with OAuth broker URL and Client ID ---
print_info "Configuring onboarding page with OAuth broker details..."
sed -i "s|const OAUTH_BROKER_URL = '.*';|const OAUTH_BROKER_URL = '${OAUTH_BROKER_URL}';|" app/shared/nginx/html/index.html
sed -i "s|const CLIENT_ID = '.*';|const CLIENT_ID = '${CLIENT_ID}';|" app/shared/nginx/html/index.html
print_success "Onboarding page configured."

# ============================================================================
# 4a. SET FILE PERMISSIONS
# ============================================================================
print_header "Step 4a: Setting File Permissions"
print_info "Ensuring migration files are readable by the database container..."
chmod -R 644 app/shared/database/migrations/*.sql
print_success "Migration file permissions have been set."

# ============================================================================
# 4b. REGISTER WITH OAUTH BROKER
# ============================================================================
print_header "Step 4b: Registering with OAuth Broker"

print_info "Registering this client VM with the OAuth broker..."
print_info "Broker URL: ${OAUTH_BROKER_URL}"
print_info "Client ID: ${CLIENT_ID}"
print_info "VM URL: https://${DOMAIN}"

# Make the registration API call
set +e  # Temporarily disable exit on error
REGISTRATION_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${OAUTH_BROKER_URL}/admin/clients" \
  -H "Content-Type: application/json" \
  -d "{
    \"client_id\": \"${CLIENT_ID}\",
    \"client_name\": \"${CLIENT_ID}\",
    \"vm_url\": \"https://${DOMAIN}\",
    \"vm_api_key\": \"${VM_API_KEY}\"
  }" 2>&1)
CURL_EXIT_CODE=$?
set -e  # Re-enable exit on error

if [ $CURL_EXIT_CODE -ne 0 ]; then
    print_error "Failed to connect to broker. curl error code: ${CURL_EXIT_CODE}"
    print_error "Response: ${REGISTRATION_RESPONSE}"
    print_info "Please check that the broker is running and accessible."
    exit 1
fi

# Extract HTTP status code (last line) and response body (everything else)
HTTP_CODE=$(echo "$REGISTRATION_RESPONSE" | tail -n 1)
RESPONSE_BODY=$(echo "$REGISTRATION_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "201" ]; then
    print_success "Successfully registered with OAuth broker!"
elif [ "$HTTP_CODE" = "409" ]; then
    print_warning "Client ID already exists in broker. Attempting to update registration..."

    # Try to update instead
    UPDATE_RESPONSE=$(curl -s -w "\n%{http_code}" -X PUT "${OAUTH_BROKER_URL}/admin/clients/${CLIENT_ID}" \
      -H "Content-Type: application/json" \
      -d "{
        \"client_name\": \"${CLIENT_ID}\",
        \"vm_url\": \"https://${DOMAIN}\",
        \"vm_api_key\": \"${VM_API_KEY}\"
      }")

    UPDATE_HTTP_CODE=$(echo "$UPDATE_RESPONSE" | tail -n 1)

    if [ "$UPDATE_HTTP_CODE" = "200" ]; then
        print_success "Successfully updated existing registration!"
    else
        print_error "Failed to update registration. HTTP Code: ${UPDATE_HTTP_CODE}"
        print_error "Response: $(echo "$UPDATE_RESPONSE" | sed '$d')"
        read -p "Do you want to continue anyway? (yes/no): " continue_anyway
        if [[ ! "$continue_anyway" =~ ^[Yy][Ee][Ss]$ ]]; then
            exit 1
        fi
    fi
else
    print_error "Failed to register with OAuth broker. HTTP Code: ${HTTP_CODE}"
    print_error "Response: ${RESPONSE_BODY}"
    print_info "Please ensure:"
    print_info "  1. The OAuth broker is running at ${OAUTH_BROKER_URL}"
    print_info "  2. The broker is accessible from this machine"
    print_info "  3. The broker's /admin/clients endpoint is working"

    read -p "Do you want to continue anyway and register manually later? (yes/no): " continue_anyway
    if [[ ! "$continue_anyway" =~ ^[Yy][Ee][Ss]$ ]]; then
        exit 1
    fi

    print_warning "Continuing without broker registration. You'll need to register manually:"
    echo ""
    echo "curl -X POST ${OAUTH_BROKER_URL}/admin/clients \\"
    echo "  -H 'Content-Type: application/json' \\"
    echo "  -d '{"
    echo "    \"client_id\": \"${CLIENT_ID}\","
    echo "    \"client_name\": \"${CLIENT_ID}\","
    echo "    \"vm_url\": \"https://${DOMAIN}\","
    echo "    \"vm_api_key\": \"${VM_API_KEY}\""
    echo "  }'"
    echo ""
fi

# ============================================================================
# 5. START DOCKER SERVICES
# ============================================================================
print_header "Step 5: Building and Starting Services"

print_info "This may take several minutes, especially on the first run..."
# Change to app directory so docker compose finds the .env file
if ! (cd app && docker compose up --build -d); then
    print_error "Failed to start Docker services!"
    print_info "Check the error messages above for details."
    print_info "You can manually start services with: cd app && docker compose up --build -d"
    exit 1
fi

print_success "All services have been started in the background."

# ============================================================================
# 5a. POST-STARTUP DATABASE FIXES
# ============================================================================
print_header "Step 5a: Configuring Database Permissions"

print_info "Waiting for PostgreSQL to be fully ready..."
sleep 10

# Fix database permissions for workers
print_info "Granting table permissions to worker user..."
(cd app && docker compose exec -T postgres psql -U rikk -d nest_meta -c "
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO \"postgres-non-root\";
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO \"postgres-non-root\";
" 2>/dev/null) && print_success "Database permissions configured." || print_warning "Could not set permissions (may already be set)."

# Ensure enrichment_jobs table exists
print_info "Ensuring enrichment_jobs table exists..."
(cd app && docker compose exec -T postgres psql -U rikk -d nest_meta -c "
CREATE TABLE IF NOT EXISTS enrichment_jobs (
    id SERIAL PRIMARY KEY,
    client_id VARCHAR(255) NOT NULL,
    content_id VARCHAR(255) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    attempts INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(client_id, content_id, content_type)
);
CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_status ON enrichment_jobs(status, created_at);
GRANT ALL PRIVILEGES ON enrichment_jobs TO \"postgres-non-root\";
GRANT USAGE, SELECT ON SEQUENCE enrichment_jobs_id_seq TO \"postgres-non-root\";
" 2>/dev/null) && print_success "Enrichment jobs table ready." || print_warning "Could not create enrichment_jobs table (may already exist)."

# ============================================================================
# 6. FINAL INSTRUCTIONS
# ============================================================================
print_header "🎉 SETUP COMPLETE! Your Content Aiviary is running. 🎉"

echo "Your system is now live and waiting for you to connect your Meta account."
echo ""
echo -e "${YELLOW}-------------------[ ACCESS YOUR AIVIARY ]-------------------${NC}"
echo ""
echo -e "  - Connect & Chat: ${GREEN}https://${DOMAIN}${NC}"
echo -e "  - n8n Workflows:  ${GREEN}https://n8n.${DOMAIN}${NC} (via tunnel)"
echo -e "  - n8n (local):    ${GREEN}http://localhost:5678${NC}"
echo ""
echo "Visit your domain to connect your Meta account, then proceed to chat."
echo ""
echo -e "${YELLOW}----------[ CRITICAL NEXT STEPS: AUTH & SYNC ]----------${NC}"
echo ""
echo "Your Aiviary is running and registered with the OAuth broker!"
echo ""
echo -e "  ${BLUE}✅ Automatic Registration Complete:${NC}"
echo "     Your client VM has been registered with the OAuth broker."
echo "     You can verify this at: ${GREEN}${OAUTH_BROKER_URL}/admin/clients${NC}"
echo ""
echo -e "  ${BLUE}1. Connect Your Meta Account:${NC}"
echo "     Go to your domain and click the 'Connect' button next to Meta/Instagram."
echo -e "     URL: ${GREEN}https://${DOMAIN}${NC}"
echo ""
echo -e "  ${BLUE}2. Verify Credential Receipt & Automated Backfill Trigger:${NC}"
echo "     After completing the OAuth flow, you'll be redirected back to the connect page."
echo "     The initial data backfill will be triggered automatically."
echo "     Run this command in a new terminal to monitor:"
echo -e "     ${GREEN}cd app && docker compose logs -f aiviary-connect${NC}"
echo "     (You should see a 'Credentials received and stored' message and a 'Created backfill job' message.)"
echo ""
echo -e "  ${BLUE}3. Access the Chat:${NC}"
echo "     Once connected, click 'Proceed to Nest' or navigate to /chat."
echo "     Register an account in Aiviary Chat to create your team."
echo -e "     URL: ${GREEN}https://${DOMAIN}/chat${NC}"
echo ""
echo -e "  ${BLUE}4. Monitor the Sync Progress:${NC}"
echo "     Your data will now begin to sync. You can monitor the progress with:"
echo -e "     - Data Fetching: ${GREEN}cd app && docker compose logs -f meta-sync-worker${NC}"
echo -e "     - AI Enrichment: ${GREEN}cd app && docker compose logs -f meta-enrichment-worker${NC}"
echo ""
echo -e "${YELLOW}----------[ CLOUDFLARE TUNNEL CONFIGURATION ]----------${NC}"
echo ""
echo -e "  Your Cloudflare tunnel should route the root domain (${DOMAIN})."
echo "  Optionally, add the n8n subdomain for admin access:"
echo ""
echo "     1. Go to your Cloudflare Zero Trust Dashboard"
echo "     2. Navigate to Networks → Tunnels → Your tunnel → Public Hostnames"
echo "     3. Add a new public hostname (optional):"
echo -e "        - Subdomain: ${GREEN}n8n${NC}"
echo -e "        - Domain: ${GREEN}${CLIENT_NAME}.theaiviary.com${NC}"
echo -e "        - Service: ${GREEN}http://nginx:80${NC}"
echo ""
echo "-------------------------------------------------------------------"
echo ""
