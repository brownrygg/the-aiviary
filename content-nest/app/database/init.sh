#!/bin/bash
set -e

# This script runs as the superuser (POSTGRES_USER) in the container.
# It sets up the databases and a dedicated non-root user for the applications.

# 1. Create the non-root user that all our services will use.
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
echo "✅ Non-root user '${POSTGRES_NON_ROOT_USER}' created or already exists."

# 2. Create the 'analytics' database and set our non-root user as the OWNER.
# As the owner, the user will have all necessary permissions by default.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "postgres" <<-EOSQL
    SELECT 'CREATE DATABASE analytics WITH OWNER = ''${POSTGRES_NON_ROOT_USER}'''
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'analytics')\gexec
EOSQL
echo "✅ 'analytics' database created and owned by '${POSTGRES_NON_ROOT_USER}'."

# 3. Grant necessary privileges on the 'n8n' database to our non-root user.
# The n8n service needs to be able to create its own tables in its database.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "postgres" <<-EOSQL
    GRANT ALL PRIVILEGES ON DATABASE ${POSTGRES_DB} TO "${POSTGRES_NON_ROOT_USER}";
EOSQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "${POSTGRES_DB}" <<-EOSQL
    GRANT ALL ON SCHEMA public TO "${POSTGRES_NON_ROOT_USER}";
EOSQL
echo "✅ Privileges granted on 'n8n' database to '${POSTGRES_NON_ROOT_USER}'."

# 4. Run migrations on the 'analytics' database.
# We run these as the superuser to ensure permissions for creating extensions (like vector).
echo "🚀 Applying migrations to 'analytics' database..."
for migration in /docker-entrypoint-initdb.d/migrations/*.sql; do
    if [ -f "$migration" ]; then
        echo "   -> Applying migration: $(basename "$migration")"
        psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "analytics" -f "$migration"
    fi
done
echo "✅ Migrations applied successfully."

# 5. Grant permissions on all tables and sequences in 'analytics' database to non-root user
echo "🔐 Granting permissions on 'analytics' database to '${POSTGRES_NON_ROOT_USER}'..."
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "analytics" <<-EOSQL
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "${POSTGRES_NON_ROOT_USER}";
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "${POSTGRES_NON_ROOT_USER}";
    GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO "${POSTGRES_NON_ROOT_USER}";
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "${POSTGRES_NON_ROOT_USER}";
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "${POSTGRES_NON_ROOT_USER}";
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO "${POSTGRES_NON_ROOT_USER}";
EOSQL
echo "✅ Permissions granted successfully."
echo "✅ Database initialization complete."