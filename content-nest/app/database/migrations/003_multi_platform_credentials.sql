-- ============================================================================
-- MULTI-PLATFORM OAUTH CREDENTIALS MIGRATION
-- Version: 003
-- Description: Migrate from Meta-only to multi-platform OAuth credentials
-- Breaking Change: Drops meta_credentials table, requires re-authentication
-- ============================================================================

-- ============================================================================
-- DROP OLD SCHEMA (FORCE MIGRATION)
-- ============================================================================

-- Drop meta_credentials table (all data will be lost, clients must re-authenticate)
DROP TABLE IF EXISTS meta_credentials CASCADE;

-- ============================================================================
-- CREATE NEW MULTI-PLATFORM CREDENTIALS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS oauth_credentials (
    id SERIAL PRIMARY KEY,
    client_id VARCHAR(255) NOT NULL,
    platform VARCHAR(50) NOT NULL,
    access_token TEXT NOT NULL,                    -- Encrypted with AES-256
    refresh_token TEXT,                             -- Encrypted, nullable (Google, YouTube use this)
    token_expires_at TIMESTAMP WITH TIME ZONE,      -- Nullable (Asana has no expiry)
    scopes TEXT[],                                  -- Array of granted OAuth scopes
    platform_metadata JSONB,                        -- Platform-specific data (account IDs, user info, etc.)
    last_refreshed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(client_id, platform)                     -- One credential per platform per client
);

-- ============================================================================
-- CREATE INDEXES FOR PERFORMANCE
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_oauth_credentials_client_platform
    ON oauth_credentials(client_id, platform);

CREATE INDEX IF NOT EXISTS idx_oauth_credentials_platform
    ON oauth_credentials(platform);

CREATE INDEX IF NOT EXISTS idx_oauth_credentials_expires
    ON oauth_credentials(token_expires_at) WHERE token_expires_at IS NOT NULL;

-- ============================================================================
-- PLATFORM METADATA STRUCTURE REFERENCE
-- ============================================================================

-- This is a reference for developers - NOT executed SQL
--
-- Meta platform_metadata structure:
-- {
--   "meta_user_id": "123456789",
--   "facebook_page_id": "987654321",
--   "instagram_business_account_id": "111222333",
--   "ad_account_id": "act_444555666",
--   "ad_library_verified": false
-- }
--
-- Asana platform_metadata structure:
-- {
--   "workspace_gid": "1234567890",
--   "user_gid": "0987654321",
--   "email": "user@example.com"
-- }
--
-- Google platform_metadata structure:
-- {
--   "email": "user@gmail.com",
--   "drive_id": "abc123"
-- }
--
-- Monday platform_metadata structure:
-- {
--   "user_id": "12345",
--   "email": "user@example.com",
--   "account_id": "67890",
--   "account_slug": "myworkspace"
-- }
--
-- Slack platform_metadata structure:
-- {
--   "team_id": "T1234567890",
--   "team_name": "My Workspace",
--   "user_id": "U0987654321",
--   "email": "user@slack.com"
-- }
--
-- LinkedIn platform_metadata structure:
-- {
--   "user_id": "abc123",
--   "first_name": "John",
--   "last_name": "Doe",
--   "email": "user@linkedin.com"
-- }
--
-- TikTok platform_metadata structure:
-- {
--   "open_id": "tiktok_open_id",
--   "display_name": "TikTok User",
--   "username": "@tiktoker"
-- }
--
-- YouTube platform_metadata structure:
-- {
--   "email": "user@gmail.com",
--   "user_id": "UC1234567890",
--   "channel_id": "UC0987654321",
--   "channel_title": "My YouTube Channel"
-- }

-- ============================================================================
-- GRANT PERMISSIONS TO NON-ROOT USER
-- ============================================================================

-- Permissions will be granted by init.sh after all migrations complete
-- This ensures the non-root user can access the new table

-- ============================================================================
-- MIGRATION NOTES
-- ============================================================================

-- ⚠️ BREAKING CHANGE WARNINGS:
-- 1. All existing Meta credentials will be LOST
-- 2. Clients MUST re-authenticate via OAuth broker
-- 3. sync-worker will need credentials before backfill can run
-- 4. Expected downtime: 5-10 minutes per client VM
--
-- Post-Migration Steps:
-- 1. Restart all services (credential-receiver, sync-worker, MCP servers)
-- 2. Navigate to onboarding page (root domain)
-- 3. Click "Connect Meta/Instagram" to re-authenticate
-- 4. Verify backfill job is created and runs successfully
-- 5. Connect additional platforms as needed (Asana, Google, etc.)

-- ============================================================================
-- END OF MIGRATION 003
-- ============================================================================
