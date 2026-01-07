"""Initial schema for multi-tenant chat application

Revision ID: 001_initial_schema
Revises:
Create Date: 2025-12-30 00:00:00.000000

Description:
    - Creates teams, users, agents, chats, and error_logs tables
    - Adds indexes for performance optimization
    - Implements updated_at auto-update triggers
    - Includes sample data for testing

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '001_initial_schema'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create all tables, indexes, and triggers for multi-tenant chat app."""

    # Enable pgcrypto extension for UUID generation
    op.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')

    # ========================================================================
    # TABLE: teams
    # ========================================================================
    op.create_table(
        'teams',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('name', sa.Text(), nullable=False),
        sa.Column('slug', sa.Text(), nullable=False, unique=True),
        sa.Column('settings', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text('NOW()')),
        sa.CheckConstraint("slug ~ '^[a-z0-9-]+$'", name='teams_slug_format'),
        sa.CheckConstraint('length(slug) >= 2 AND length(slug) <= 50', name='teams_slug_length'),
        comment='Multi-tenant teams for logical data isolation'
    )

    # ========================================================================
    # TABLE: users
    # ========================================================================
    op.create_table(
        'users',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('team_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('email', sa.Text(), nullable=False),
        sa.Column('password_hash', sa.Text(), nullable=False),
        sa.Column('full_name', sa.Text(), nullable=True),
        sa.Column('role', sa.Text(), nullable=False, server_default='user'),
        sa.Column('avatar', sa.Text(), nullable=True),
        sa.Column('preferences', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('last_login_at', sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text('NOW()')),
        sa.ForeignKeyConstraint(['team_id'], ['teams.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('team_id', 'email', name='users_email_team_unique'),
        sa.CheckConstraint("role IN ('user', 'admin')", name='users_role_check'),
        sa.CheckConstraint("email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$'", name='users_email_format'),
        comment='User accounts with team membership and authentication'
    )

    # ========================================================================
    # TABLE: agents
    # ========================================================================
    op.create_table(
        'agents',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('team_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.Text(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('webhook_url', sa.Text(), nullable=False, unique=True),
        sa.Column('webhook_token', sa.Text(), nullable=True),
        sa.Column('system_prompt', sa.Text(), nullable=True),
        sa.Column('avatar', sa.Text(), nullable=True),
        sa.Column('config', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text('NOW()')),
        sa.ForeignKeyConstraint(['team_id'], ['teams.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        comment='AI agents backed by n8n webhooks'
    )

    # ========================================================================
    # TABLE: chats
    # ========================================================================
    op.create_table(
        'chats',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('team_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('agent_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('title', sa.Text(), nullable=True),
        sa.Column('messages', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column('metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('is_archived', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text('NOW()')),
        sa.ForeignKeyConstraint(['team_id'], ['teams.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['agent_id'], ['agents.id'], ondelete='CASCADE'),
        sa.CheckConstraint("jsonb_typeof(messages) = 'array'", name='chats_messages_is_array'),
        comment='Conversations with JSONB message storage (Open WebUI pattern)'
    )

    # ========================================================================
    # TABLE: error_logs
    # ========================================================================
    op.create_table(
        'error_logs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('team_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('agent_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('chat_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('level', sa.Text(), nullable=False, server_default='error'),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('details', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text('NOW()')),
        sa.ForeignKeyConstraint(['team_id'], ['teams.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['agent_id'], ['agents.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['chat_id'], ['chats.id'], ondelete='SET NULL'),
        sa.CheckConstraint("level IN ('info', 'warning', 'error', 'critical')", name='error_logs_level_check'),
        comment='Application error tracking for debugging'
    )

    # ========================================================================
    # INDEXES
    # ========================================================================

    # Teams indexes
    op.create_index('idx_teams_slug', 'teams', ['slug'])
    op.create_index('idx_teams_is_active', 'teams', ['is_active'], postgresql_where=sa.text('is_active = true'))

    # Users indexes
    op.create_index('idx_users_team_id', 'users', ['team_id'])
    op.create_index('idx_users_email', 'users', ['email'])
    op.create_index('idx_users_is_active', 'users', ['is_active'], postgresql_where=sa.text('is_active = true'))
    op.create_index('idx_users_team_active', 'users', ['team_id', 'is_active'])

    # Agents indexes
    op.create_index('idx_agents_team_id', 'agents', ['team_id'])
    op.create_index('idx_agents_created_by', 'agents', ['created_by'])
    op.create_index('idx_agents_is_active', 'agents', ['is_active'], postgresql_where=sa.text('is_active = true'))
    op.create_index('idx_agents_team_active', 'agents', ['team_id', 'is_active'])

    # Chats indexes
    op.create_index('idx_chats_team_id', 'chats', ['team_id'])
    op.create_index('idx_chats_user_id', 'chats', ['user_id'])
    op.create_index('idx_chats_agent_id', 'chats', ['agent_id'])
    op.create_index('idx_chats_is_archived', 'chats', ['is_archived'])
    op.create_index('idx_chats_user_active', 'chats', ['user_id', 'is_archived'], postgresql_where=sa.text('is_archived = false'))
    op.create_index('idx_chats_created_at_desc', 'chats', [sa.text('created_at DESC')])
    # GIN index for JSONB search
    op.create_index('idx_chats_messages_gin', 'chats', ['messages'], postgresql_using='gin')

    # Error logs indexes
    op.create_index('idx_error_logs_team_id', 'error_logs', ['team_id'])
    op.create_index('idx_error_logs_user_id', 'error_logs', ['user_id'])
    op.create_index('idx_error_logs_level', 'error_logs', ['level'])
    op.create_index('idx_error_logs_created_at_desc', 'error_logs', [sa.text('created_at DESC')])
    op.create_index('idx_error_logs_team_created', 'error_logs', ['team_id', sa.text('created_at DESC')])

    # ========================================================================
    # TRIGGER FUNCTION: update_updated_at_column
    # ========================================================================
    op.execute("""
        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)

    # ========================================================================
    # TRIGGERS: Auto-update updated_at timestamps
    # ========================================================================
    op.execute("""
        CREATE TRIGGER update_teams_updated_at
        BEFORE UPDATE ON teams
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    """)

    op.execute("""
        CREATE TRIGGER update_users_updated_at
        BEFORE UPDATE ON users
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    """)

    op.execute("""
        CREATE TRIGGER update_agents_updated_at
        BEFORE UPDATE ON agents
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    """)

    op.execute("""
        CREATE TRIGGER update_chats_updated_at
        BEFORE UPDATE ON chats
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    """)

    # ========================================================================
    # SAMPLE DATA (optional - comment out for production)
    # ========================================================================

    # Insert sample team
    op.execute("""
        INSERT INTO teams (name, slug, settings) VALUES
        ('Demo Team', 'demo-team', '{"max_users": 5, "features": ["agent_chat"]}'::jsonb);
    """)

    # Insert sample user (password: "password123" hashed with bcrypt)
    op.execute("""
        INSERT INTO users (team_id, email, password_hash, full_name, role)
        SELECT
            id,
            'admin@demo-team.com',
            '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5tz0rMvdO.aGi',
            'Admin User',
            'admin'
        FROM teams WHERE slug = 'demo-team';
    """)

    # Insert sample agent
    op.execute("""
        INSERT INTO agents (team_id, created_by, name, description, webhook_url, system_prompt)
        SELECT
            t.id,
            u.id,
            'Support Bot',
            'Customer support assistant',
            'https://n8n.example.com/webhook/support-bot',
            'You are a helpful customer support assistant. Be concise and friendly.'
        FROM teams t
        CROSS JOIN users u
        WHERE t.slug = 'demo-team' AND u.email = 'admin@demo-team.com';
    """)

    # Insert sample chat
    op.execute("""
        INSERT INTO chats (team_id, user_id, agent_id, title, messages)
        SELECT
            t.id,
            u.id,
            a.id,
            'Test Conversation',
            '[
                {"role": "user", "content": "Hello, I need help", "timestamp": "2025-12-30T10:00:00Z"},
                {"role": "assistant", "content": "Hi! How can I assist you today?", "timestamp": "2025-12-30T10:00:01Z"}
            ]'::jsonb
        FROM teams t
        CROSS JOIN users u
        CROSS JOIN agents a
        WHERE t.slug = 'demo-team'
          AND u.email = 'admin@demo-team.com'
          AND a.name = 'Support Bot';
    """)


def downgrade() -> None:
    """Drop all tables, indexes, triggers, and functions."""

    # Drop triggers
    op.execute('DROP TRIGGER IF EXISTS update_chats_updated_at ON chats')
    op.execute('DROP TRIGGER IF EXISTS update_agents_updated_at ON agents')
    op.execute('DROP TRIGGER IF EXISTS update_users_updated_at ON users')
    op.execute('DROP TRIGGER IF EXISTS update_teams_updated_at ON teams')

    # Drop trigger function
    op.execute('DROP FUNCTION IF EXISTS update_updated_at_column')

    # Drop indexes (explicit drops for clarity, though CASCADE handles this)
    op.drop_index('idx_error_logs_team_created', table_name='error_logs')
    op.drop_index('idx_error_logs_created_at_desc', table_name='error_logs')
    op.drop_index('idx_error_logs_level', table_name='error_logs')
    op.drop_index('idx_error_logs_user_id', table_name='error_logs')
    op.drop_index('idx_error_logs_team_id', table_name='error_logs')

    op.drop_index('idx_chats_messages_gin', table_name='chats')
    op.drop_index('idx_chats_created_at_desc', table_name='chats')
    op.drop_index('idx_chats_user_active', table_name='chats')
    op.drop_index('idx_chats_is_archived', table_name='chats')
    op.drop_index('idx_chats_agent_id', table_name='chats')
    op.drop_index('idx_chats_user_id', table_name='chats')
    op.drop_index('idx_chats_team_id', table_name='chats')

    op.drop_index('idx_agents_team_active', table_name='agents')
    op.drop_index('idx_agents_is_active', table_name='agents')
    op.drop_index('idx_agents_created_by', table_name='agents')
    op.drop_index('idx_agents_team_id', table_name='agents')

    op.drop_index('idx_users_team_active', table_name='users')
    op.drop_index('idx_users_is_active', table_name='users')
    op.drop_index('idx_users_email', table_name='users')
    op.drop_index('idx_users_team_id', table_name='users')

    op.drop_index('idx_teams_is_active', table_name='teams')
    op.drop_index('idx_teams_slug', table_name='teams')

    # Drop tables (order matters due to foreign keys)
    op.drop_table('error_logs')
    op.drop_table('chats')
    op.drop_table('agents')
    op.drop_table('users')
    op.drop_table('teams')

    # Drop extension (optional - may be used by other schemas)
    # op.execute('DROP EXTENSION IF EXISTS "pgcrypto"')
