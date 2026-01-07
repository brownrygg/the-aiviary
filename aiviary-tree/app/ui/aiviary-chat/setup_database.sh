#!/bin/bash

# ============================================================================
# Database Setup Script for Multi-Tenant Chat Application
# ============================================================================
# Usage:
#   ./setup_database.sh                    # Interactive mode
#   ./setup_database.sh --auto             # Auto mode (uses defaults)
#   ./setup_database.sh --container=postgres --db=chatapp
# ============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
DEFAULT_CONTAINER="postgres"
DEFAULT_DATABASE="chatapp"
DEFAULT_USER="chatapp_user"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Parse command line arguments
AUTO_MODE=false
CONTAINER_NAME=""
DATABASE_NAME=""
DATABASE_USER=""

for arg in "$@"; do
    case $arg in
        --auto)
            AUTO_MODE=true
            ;;
        --container=*)
            CONTAINER_NAME="${arg#*=}"
            ;;
        --db=*)
            DATABASE_NAME="${arg#*=}"
            ;;
        --user=*)
            DATABASE_USER="${arg#*=}"
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --auto              Run in auto mode with defaults"
            echo "  --container=NAME    Docker container name (default: $DEFAULT_CONTAINER)"
            echo "  --db=NAME          Database name (default: $DEFAULT_DATABASE)"
            echo "  --user=NAME        Database user (default: $DEFAULT_USER)"
            echo "  --help             Show this help message"
            exit 0
            ;;
    esac
done

# ============================================================================
# Functions
# ============================================================================

print_header() {
    echo -e "\n${BLUE}================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

# ============================================================================
# Main Setup
# ============================================================================

print_header "Multi-Tenant Chat Application Database Setup"

# Get configuration
if [ "$AUTO_MODE" = true ]; then
    print_info "Running in auto mode with defaults..."
    CONTAINER_NAME=${CONTAINER_NAME:-$DEFAULT_CONTAINER}
    DATABASE_NAME=${DATABASE_NAME:-$DEFAULT_DATABASE}
    DATABASE_USER=${DATABASE_USER:-$DEFAULT_USER}
else
    echo "Enter Docker container name [${DEFAULT_CONTAINER}]:"
    read -r input_container
    CONTAINER_NAME=${input_container:-$DEFAULT_CONTAINER}

    echo "Enter database name [${DEFAULT_DATABASE}]:"
    read -r input_db
    DATABASE_NAME=${input_db:-$DEFAULT_DATABASE}

    echo "Enter database user [${DEFAULT_USER}]:"
    read -r input_user
    DATABASE_USER=${input_user:-$DEFAULT_USER}
fi

print_info "Configuration:"
echo "  Container: $CONTAINER_NAME"
echo "  Database:  $DATABASE_NAME"
echo "  User:      $DATABASE_USER"
echo ""

# Check if Docker container exists
print_header "Checking Docker Container"
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    print_success "Container '$CONTAINER_NAME' found"
else
    print_error "Container '$CONTAINER_NAME' not found"
    echo "Available containers:"
    docker ps --format "  - {{.Names}}"
    exit 1
fi

# Check if container is running
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    print_success "Container '$CONTAINER_NAME' is running"
else
    print_warning "Container '$CONTAINER_NAME' is not running"
    echo "Do you want to start it? (y/n)"
    read -r start_container
    if [ "$start_container" = "y" ]; then
        docker start "$CONTAINER_NAME"
        print_success "Container started"
        sleep 2
    else
        print_error "Cannot proceed with stopped container"
        exit 1
    fi
fi

# Create database and user
print_header "Creating Database and User"

# Check if database exists
if docker exec "$CONTAINER_NAME" psql -U postgres -lqt | cut -d \| -f 1 | grep -qw "$DATABASE_NAME"; then
    print_warning "Database '$DATABASE_NAME' already exists"
    if [ "$AUTO_MODE" = false ]; then
        echo "Do you want to drop and recreate it? (y/n)"
        read -r drop_db
        if [ "$drop_db" = "y" ]; then
            docker exec "$CONTAINER_NAME" psql -U postgres -c "DROP DATABASE IF EXISTS $DATABASE_NAME;"
            print_success "Database dropped"
        else
            print_info "Skipping database creation"
        fi
    fi
fi

# Create database if it doesn't exist
if ! docker exec "$CONTAINER_NAME" psql -U postgres -lqt | cut -d \| -f 1 | grep -qw "$DATABASE_NAME"; then
    docker exec "$CONTAINER_NAME" psql -U postgres -c "CREATE DATABASE $DATABASE_NAME;"
    print_success "Database '$DATABASE_NAME' created"
fi

# Create user if it doesn't exist
if docker exec "$CONTAINER_NAME" psql -U postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DATABASE_USER'" | grep -q 1; then
    print_warning "User '$DATABASE_USER' already exists"
else
    RANDOM_PASSWORD=$(openssl rand -base64 16)
    docker exec "$CONTAINER_NAME" psql -U postgres -c "CREATE USER $DATABASE_USER WITH PASSWORD '$RANDOM_PASSWORD';"
    docker exec "$CONTAINER_NAME" psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE $DATABASE_NAME TO $DATABASE_USER;"
    print_success "User '$DATABASE_USER' created with password: $RANDOM_PASSWORD"
    echo "  IMPORTANT: Save this password securely!"
fi

# Apply schema
print_header "Applying Database Schema"

if [ -f "$SCRIPT_DIR/schema.sql" ]; then
    print_info "Applying schema from schema.sql..."
    docker exec -i "$CONTAINER_NAME" psql -U postgres -d "$DATABASE_NAME" < "$SCRIPT_DIR/schema.sql"
    print_success "Schema applied successfully"
else
    print_error "schema.sql not found in $SCRIPT_DIR"
    exit 1
fi

# Verify tables
print_header "Verifying Database Tables"

tables=$(docker exec "$CONTAINER_NAME" psql -U postgres -d "$DATABASE_NAME" -tAc "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;")

if [ -n "$tables" ]; then
    print_success "Tables created:"
    echo "$tables" | while read -r table; do
        echo "  - $table"
    done
else
    print_error "No tables found"
    exit 1
fi

# Grant permissions to user
print_header "Granting Permissions"
docker exec "$CONTAINER_NAME" psql -U postgres -d "$DATABASE_NAME" -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO $DATABASE_USER;"
docker exec "$CONTAINER_NAME" psql -U postgres -d "$DATABASE_NAME" -c "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO $DATABASE_USER;"
docker exec "$CONTAINER_NAME" psql -U postgres -d "$DATABASE_NAME" -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $DATABASE_USER;"
print_success "Permissions granted"

# Verify sample data
print_header "Verifying Sample Data"

team_count=$(docker exec "$CONTAINER_NAME" psql -U postgres -d "$DATABASE_NAME" -tAc "SELECT COUNT(*) FROM teams;")
user_count=$(docker exec "$CONTAINER_NAME" psql -U postgres -d "$DATABASE_NAME" -tAc "SELECT COUNT(*) FROM users;")
agent_count=$(docker exec "$CONTAINER_NAME" psql -U postgres -d "$DATABASE_NAME" -tAc "SELECT COUNT(*) FROM agents;")
chat_count=$(docker exec "$CONTAINER_NAME" psql -U postgres -d "$DATABASE_NAME" -tAc "SELECT COUNT(*) FROM chats;")

print_success "Sample data loaded:"
echo "  Teams:  $team_count"
echo "  Users:  $user_count"
echo "  Agents: $agent_count"
echo "  Chats:  $chat_count"

# Database connection info
print_header "Database Connection Information"

cat << EOF
Connection Details:
  Host:     localhost (or container IP)
  Port:     5432
  Database: $DATABASE_NAME
  User:     $DATABASE_USER

Connection String (SQLAlchemy):
  postgresql://$DATABASE_USER:YOUR_PASSWORD@localhost:5432/$DATABASE_NAME

Connection String (psycopg2):
  host=localhost port=5432 dbname=$DATABASE_NAME user=$DATABASE_USER password=YOUR_PASSWORD

Docker Exec Command:
  docker exec -it $CONTAINER_NAME psql -U postgres -d $DATABASE_NAME
EOF

# Summary
print_header "Setup Complete!"

print_success "Database setup completed successfully"
print_info "Sample team credentials:"
echo "  Email:    admin@demo-team.com"
echo "  Password: password123 (bcrypt hash stored in DB)"
echo ""
print_warning "Next Steps:"
echo "  1. Update your application's database connection string"
echo "  2. Review the schema in schema.sql"
echo "  3. Check example queries in example_queries.sql"
echo "  4. Read design documentation in SCHEMA_DESIGN.md"
echo ""
print_info "Useful Commands:"
echo "  psql:   docker exec -it $CONTAINER_NAME psql -U postgres -d $DATABASE_NAME"
echo "  backup: pg_dump -U postgres -d $DATABASE_NAME > backup.sql"
echo "  logs:   docker logs $CONTAINER_NAME"
echo ""

exit 0
