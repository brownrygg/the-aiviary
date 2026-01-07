#!/bin/bash
set -e

# =============================================================================
# Aiviary Tree - Database Initialization Script
# =============================================================================
# This script creates isolated databases for each component:
#   - aiviary_chat: Chat UI (users, teams, agents, chats)
#   - n8n_db: n8n workflow engine
#   - nest_meta: Meta platform nest (Instagram, Ads analytics)
#
# Each database is isolated to enable modular addition/removal of components.
# =============================================================================

echo "🚀 Starting Aiviary Tree database initialization..."

# -----------------------------------------------------------------------------
# 1. Create the non-root application user
# -----------------------------------------------------------------------------
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "postgres" <<-EOSQL
    DO \$\$
    BEGIN
       IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${POSTGRES_NON_ROOT_USER}') THEN
          CREATE USER "${POSTGRES_NON_ROOT_USER}" WITH PASSWORD '${POSTGRES_NON_ROOT_PASSWORD}';
       ELSE
          RAISE NOTICE 'Role "${POSTGRES_NON_ROOT_USER}" already exists, skipping creation.';
       END IF;
    END
    \$\$;
EOSQL
echo "✅ Application user '${POSTGRES_NON_ROOT_USER}' created or already exists."

# -----------------------------------------------------------------------------
# 2. Create CORE databases (always present in every Tree deployment)
# -----------------------------------------------------------------------------

# 2a. aiviary_chat - Chat UI database (auth, teams, agents, chats, messages)
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "postgres" <<-EOSQL
    SELECT 'CREATE DATABASE aiviary_chat WITH OWNER = ''${POSTGRES_NON_ROOT_USER}'''
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'aiviary_chat')\gexec
EOSQL
echo "✅ Core database 'aiviary_chat' created."

# 2b. n8n_db - Workflow engine database
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "postgres" <<-EOSQL
    SELECT 'CREATE DATABASE n8n_db WITH OWNER = ''${POSTGRES_NON_ROOT_USER}'''
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'n8n_db')\gexec
EOSQL
# Grant schema privileges for n8n
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "n8n_db" <<-EOSQL
    GRANT ALL ON SCHEMA public TO "${POSTGRES_NON_ROOT_USER}";
EOSQL
echo "✅ Core database 'n8n_db' created."

# -----------------------------------------------------------------------------
# 3. Create NEST databases (modular - add/remove per deployment)
# -----------------------------------------------------------------------------

# 3a. nest_meta - Meta platform nest (Instagram, Ads, Ad Library)
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "postgres" <<-EOSQL
    SELECT 'CREATE DATABASE nest_meta WITH OWNER = ''${POSTGRES_NON_ROOT_USER}'''
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'nest_meta')\gexec
EOSQL
echo "✅ Nest database 'nest_meta' created."

# Enable vector extension for nest_meta (for embeddings)
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "nest_meta" <<-EOSQL
    CREATE EXTENSION IF NOT EXISTS vector;
    GRANT ALL ON SCHEMA public TO "${POSTGRES_NON_ROOT_USER}";
EOSQL
echo "✅ Vector extension enabled in 'nest_meta'."

# -----------------------------------------------------------------------------
# 4. Run migrations for nest_meta
# -----------------------------------------------------------------------------
echo "🚀 Applying migrations to 'nest_meta' database..."
for migration in /docker-entrypoint-initdb.d/migrations/*.sql; do
    if [ -f "$migration" ]; then
        echo "   -> Applying migration: $(basename "$migration")"
        psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "nest_meta" -f "$migration"
    fi
done
echo "✅ Migrations applied to 'nest_meta'."

# -----------------------------------------------------------------------------
# 5. Grant final permissions on nest_meta tables
# -----------------------------------------------------------------------------
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "nest_meta" <<-EOSQL
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "${POSTGRES_NON_ROOT_USER}";
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "${POSTGRES_NON_ROOT_USER}";
    GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO "${POSTGRES_NON_ROOT_USER}";
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "${POSTGRES_NON_ROOT_USER}";
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "${POSTGRES_NON_ROOT_USER}";
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO "${POSTGRES_NON_ROOT_USER}";
EOSQL
echo "✅ Permissions configured for 'nest_meta'."

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "=============================================="
echo "🎉 Aiviary Tree Database Initialization Complete"
echo "=============================================="
echo "Databases created:"
echo "  - aiviary_chat (Chat UI)"
echo "  - n8n_db (Workflow engine)"
echo "  - nest_meta (Meta platform analytics)"
echo ""
echo "To add new nests, update this script with additional database blocks."
echo "=============================================="
