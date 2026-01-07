-- ============================================================================
-- Multi-Tenant Chat Application Database Schema
-- ============================================================================
-- Description: Lightweight schema for teams of 2-5 users sharing VM instances
-- Design: Inspired by Open WebUI's JSONB chat storage pattern
-- Target: PostgreSQL 12+
-- ============================================================================

-- Enable UUID extension (required for gen_random_uuid())
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- TABLE: teams
-- ============================================================================
-- Purpose: Logical grouping for multi-tenancy (2-5 users per team)
-- Isolation: All data is partitioned by team_id
-- ============================================================================
CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    -- Subdomain or team slug for URL routing (e.g., team-alpha.app.com)
    slug TEXT NOT NULL UNIQUE,
    -- Team settings stored as JSONB for flexibility
    -- Example: {"max_users": 5, "features": ["agent_chat", "webhooks"]}
    settings JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT teams_slug_format CHECK (slug ~ '^[a-z0-9-]+$'),
    CONSTRAINT teams_slug_length CHECK (length(slug) >= 2 AND length(slug) <= 50)
);

COMMENT ON TABLE teams IS 'Multi-tenant teams for logical data isolation';
COMMENT ON COLUMN teams.slug IS 'URL-friendly team identifier (lowercase, hyphens)';
COMMENT ON COLUMN teams.settings IS 'Flexible team configuration as JSONB';

-- ============================================================================
-- TABLE: users
-- ============================================================================
-- Purpose: User authentication, profiles, and team membership
-- Security: Passwords hashed at application layer (bcrypt/argon2)
-- ============================================================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    -- Password hash stored here (hashed by FastAPI/Flask before insert)
    password_hash TEXT NOT NULL,
    full_name TEXT,
    -- Role-based access: 'user' has read/write, 'admin' has full control
    role TEXT NOT NULL DEFAULT 'user',
    -- User avatar as base64 data URI (e.g., "data:image/png;base64,iVBOR...")
    avatar TEXT,
    -- User preferences stored as JSONB
    -- Example: {"theme": "dark", "notifications": true, "language": "en"}
    preferences JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT true,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Email must be unique within a team (same email can exist in different teams)
    CONSTRAINT users_email_team_unique UNIQUE (team_id, email),
    CONSTRAINT users_role_check CHECK (role IN ('user', 'admin')),
    CONSTRAINT users_email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

COMMENT ON TABLE users IS 'User accounts with team membership and authentication';
COMMENT ON COLUMN users.password_hash IS 'Bcrypt/Argon2 hash (never store plaintext)';
COMMENT ON COLUMN users.avatar IS 'Base64 data URI for profile picture';
COMMENT ON COLUMN users.role IS 'Access level: user (read/write) or admin (full control)';

-- ============================================================================
-- TABLE: agents
-- ============================================================================
-- Purpose: n8n webhook configurations for AI agents
-- Pattern: Each agent is backed by an n8n workflow with webhook trigger
-- Security: Webhook tokens encrypted at application layer before storage
-- ============================================================================
CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    -- Created by user (for audit trail)
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    -- n8n webhook URL (e.g., "https://n8n.example.com/webhook/agent-123")
    webhook_url TEXT NOT NULL,
    -- Webhook authentication token (encrypted by app before storage)
    webhook_token TEXT,
    -- System prompt for the agent's personality/instructions
    system_prompt TEXT,
    -- Agent avatar as base64 data URI
    avatar TEXT,
    -- Agent configuration stored as JSONB
    -- Example: {"model": "gpt-4", "temperature": 0.7, "max_tokens": 2000}
    config JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT agents_webhook_url_unique UNIQUE (webhook_url)
);

COMMENT ON TABLE agents IS 'AI agents backed by n8n webhooks';
COMMENT ON COLUMN agents.webhook_url IS 'n8n webhook endpoint for agent communication';
COMMENT ON COLUMN agents.webhook_token IS 'Encrypted auth token for webhook security';
COMMENT ON COLUMN agents.system_prompt IS 'Agent personality and instruction template';
COMMENT ON COLUMN agents.config IS 'LLM settings (model, temperature, tokens, etc.)';

-- ============================================================================
-- TABLE: chats
-- ============================================================================
-- Purpose: Conversations with JSONB-stored message history
-- Pattern: Inspired by Open WebUI - entire chat stored as JSON array
-- Trade-off: Simplicity over normalization (perfect for small teams)
-- ============================================================================
CREATE TABLE chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    title TEXT,
    -- Message history stored as JSONB array
    -- Format: [
    --   {"role": "user", "content": "Hello", "timestamp": "2025-12-30T10:00:00Z"},
    --   {"role": "assistant", "content": "Hi!", "timestamp": "2025-12-30T10:00:01Z"}
    -- ]
    messages JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Chat metadata (tags, pinned status, etc.)
    -- Example: {"tags": ["important", "support"], "pinned": true}
    metadata JSONB DEFAULT '{}'::jsonb,
    -- Archive inactive chats without deleting
    is_archived BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chats_messages_is_array CHECK (jsonb_typeof(messages) = 'array')
);

COMMENT ON TABLE chats IS 'Conversations with JSONB message storage (Open WebUI pattern)';
COMMENT ON COLUMN chats.messages IS 'Message history as JSON array (role, content, timestamp)';
COMMENT ON COLUMN chats.metadata IS 'Flexible chat properties (tags, pinned, etc.)';
COMMENT ON COLUMN chats.is_archived IS 'Soft archive flag (keep data but hide from UI)';

-- ============================================================================
-- TABLE: error_logs
-- ============================================================================
-- Purpose: Track application errors for admin debugging
-- Retention: Consider purging old logs (e.g., DELETE WHERE created_at < NOW() - INTERVAL '90 days')
-- ============================================================================
CREATE TABLE error_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    chat_id UUID REFERENCES chats(id) ON DELETE SET NULL,
    -- Error severity: 'info', 'warning', 'error', 'critical'
    level TEXT NOT NULL DEFAULT 'error',
    -- Error message or description
    message TEXT NOT NULL,
    -- Full stack trace or additional context
    -- Example: {"stack": "...", "request_id": "abc123", "endpoint": "/api/chat"}
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT error_logs_level_check CHECK (level IN ('info', 'warning', 'error', 'critical'))
);

COMMENT ON TABLE error_logs IS 'Application error tracking for debugging';
COMMENT ON COLUMN error_logs.level IS 'Severity: info, warning, error, critical';
COMMENT ON COLUMN error_logs.details IS 'Stack traces, request IDs, additional context';

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Teams indexes
CREATE INDEX idx_teams_slug ON teams(slug);
CREATE INDEX idx_teams_is_active ON teams(is_active) WHERE is_active = true;

-- Users indexes
CREATE INDEX idx_users_team_id ON users(team_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_is_active ON users(is_active) WHERE is_active = true;
-- Composite index for team-scoped queries
CREATE INDEX idx_users_team_active ON users(team_id, is_active);

-- Agents indexes
CREATE INDEX idx_agents_team_id ON agents(team_id);
CREATE INDEX idx_agents_created_by ON agents(created_by);
CREATE INDEX idx_agents_is_active ON agents(is_active) WHERE is_active = true;
-- Composite index for team-scoped active agents
CREATE INDEX idx_agents_team_active ON agents(team_id, is_active);

-- Chats indexes
CREATE INDEX idx_chats_team_id ON chats(team_id);
CREATE INDEX idx_chats_user_id ON chats(user_id);
CREATE INDEX idx_chats_agent_id ON chats(agent_id);
CREATE INDEX idx_chats_is_archived ON chats(is_archived);
-- Composite index for user's active chats (most common query)
CREATE INDEX idx_chats_user_active ON chats(user_id, is_archived) WHERE is_archived = false;
-- Index for recent chats (pagination)
CREATE INDEX idx_chats_created_at_desc ON chats(created_at DESC);
-- GIN index for JSONB message search (optional - enables full-text search)
CREATE INDEX idx_chats_messages_gin ON chats USING gin(messages);

-- Error logs indexes
CREATE INDEX idx_error_logs_team_id ON error_logs(team_id);
CREATE INDEX idx_error_logs_user_id ON error_logs(user_id);
CREATE INDEX idx_error_logs_level ON error_logs(level);
CREATE INDEX idx_error_logs_created_at_desc ON error_logs(created_at DESC);
-- Composite index for recent team errors
CREATE INDEX idx_error_logs_team_created ON error_logs(team_id, created_at DESC);

-- ============================================================================
-- TRIGGER FUNCTION: Update updated_at timestamp
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_updated_at_column IS 'Auto-update updated_at timestamp on row modification';

-- ============================================================================
-- TRIGGERS: Auto-update updated_at timestamps
-- ============================================================================
CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON teams
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_agents_updated_at BEFORE UPDATE ON agents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_chats_updated_at BEFORE UPDATE ON chats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- SAMPLE DATA (for testing)
-- ============================================================================

-- Insert sample team
INSERT INTO teams (name, slug, settings) VALUES
    ('Demo Team', 'demo-team', '{"max_users": 5, "features": ["agent_chat"]}');

-- Insert sample user (password: "password123" hashed with bcrypt)
INSERT INTO users (team_id, email, password_hash, full_name, role) VALUES
    (
        (SELECT id FROM teams WHERE slug = 'demo-team'),
        'admin@demo-team.com',
        '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5tz0rMvdO.aGi',
        'Admin User',
        'admin'
    );

-- Insert sample agent
INSERT INTO agents (team_id, created_by, name, description, webhook_url, system_prompt) VALUES
    (
        (SELECT id FROM teams WHERE slug = 'demo-team'),
        (SELECT id FROM users WHERE email = 'admin@demo-team.com'),
        'Support Bot',
        'Customer support assistant',
        'https://n8n.example.com/webhook/support-bot',
        'You are a helpful customer support assistant. Be concise and friendly.'
    );

-- Insert sample chat with messages
INSERT INTO chats (team_id, user_id, agent_id, title, messages) VALUES
    (
        (SELECT id FROM teams WHERE slug = 'demo-team'),
        (SELECT id FROM users WHERE email = 'admin@demo-team.com'),
        (SELECT id FROM agents WHERE name = 'Support Bot'),
        'Test Conversation',
        '[
            {"role": "user", "content": "Hello, I need help", "timestamp": "2025-12-30T10:00:00Z"},
            {"role": "assistant", "content": "Hi! How can I assist you today?", "timestamp": "2025-12-30T10:00:01Z"}
        ]'::jsonb
    );

-- ============================================================================
-- USEFUL QUERIES (for reference)
-- ============================================================================

-- Get all active agents for a team
-- SELECT * FROM agents WHERE team_id = ? AND is_active = true ORDER BY name;

-- Get user's recent chats (paginated)
-- SELECT * FROM chats
-- WHERE user_id = ? AND is_archived = false
-- ORDER BY updated_at DESC
-- LIMIT 20 OFFSET 0;

-- Search messages within chats (using GIN index)
-- SELECT * FROM chats
-- WHERE team_id = ? AND messages @> '[{"content": "keyword"}]'::jsonb;

-- Get error logs for a team (last 7 days)
-- SELECT * FROM error_logs
-- WHERE team_id = ? AND created_at > NOW() - INTERVAL '7 days'
-- ORDER BY created_at DESC;

-- Count messages in a chat
-- SELECT id, title, jsonb_array_length(messages) as message_count
-- FROM chats
-- WHERE user_id = ?;
