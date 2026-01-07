"""
SQLAlchemy database models matching schema.sql.

Security considerations:
- Passwords are never stored in plain text
- Email addresses are indexed for fast lookup
- Timestamps track account activity
- Multi-tenant isolation via team_id
- UUID primary keys for better security
"""

from datetime import datetime
import uuid
from typing import Optional
from sqlalchemy import Boolean, Column, DateTime, String, Text, Index, ForeignKey, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import validates, relationship

Base = declarative_base()


class Team(Base):
    """
    Team model for multi-tenancy.

    Each team is a logical grouping of 2-5 users sharing a VM instance.
    All data is partitioned by team_id for isolation.
    """
    __tablename__ = "teams"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(Text, nullable=False)
    slug = Column(Text, unique=True, nullable=False, index=True)
    settings = Column(JSONB, nullable=False, default={})
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    users = relationship("User", back_populates="team", cascade="all, delete-orphan")
    agents = relationship("Agent", back_populates="team", cascade="all, delete-orphan")
    chats = relationship("Chat", back_populates="team", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint("slug ~ '^[a-z0-9-]+$'", name="teams_slug_format"),
        CheckConstraint("length(slug) >= 2 AND length(slug) <= 50", name="teams_slug_length"),
    )

    def __repr__(self):
        return f"<Team(id={self.id}, slug={self.slug}, name={self.name})>"


class User(Base):
    """
    User model for authentication and authorization.

    Security features:
    - password_hash: bcrypt hash with 12+ rounds
    - is_active: soft delete capability without data loss
    - created_at/updated_at: audit trail
    - email unique within team (can exist across teams)
    - Multi-tenant isolation via team_id
    """
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    team_id = Column(UUID(as_uuid=True), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True)
    email = Column(Text, nullable=False, index=True)
    password_hash = Column(Text, nullable=False)
    full_name = Column(Text, nullable=True)
    role = Column(Text, nullable=False, default="user")
    avatar = Column(Text, nullable=True)
    preferences = Column(JSONB, nullable=False, default={})
    is_active = Column(Boolean, default=True, nullable=False)
    last_login_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    team = relationship("Team", back_populates="users")
    created_agents = relationship("Agent", back_populates="creator", foreign_keys="Agent.created_by")
    chats = relationship("Chat", back_populates="user", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_users_team_id", "team_id"),
        Index("idx_users_email", "email"),
        Index("idx_users_team_active", "team_id", "is_active"),
        CheckConstraint("role IN ('user', 'admin')", name="users_role_check"),
        CheckConstraint("email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$'", name="users_email_format"),
        # Email unique within team
        Index("idx_users_email_team_unique", "team_id", "email", unique=True),
    )

    @validates('email')
    def validate_email(self, key, email):
        """Normalize email to lowercase for consistent storage."""
        if email:
            return email.lower().strip()
        return email

    def __repr__(self):
        return f"<User(id={self.id}, email={self.email}, team_id={self.team_id})>"


class Agent(Base):
    """
    AI Agent model backed by n8n webhooks.

    Each agent represents an n8n workflow with webhook trigger.
    """
    __tablename__ = "agents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    team_id = Column(UUID(as_uuid=True), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=False)
    name = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    webhook_url = Column(Text, nullable=False, unique=True)
    webhook_token = Column(Text, nullable=True)
    system_prompt = Column(Text, nullable=True)
    avatar = Column(Text, nullable=True)
    config = Column(JSONB, nullable=False, default={})
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    team = relationship("Team", back_populates="agents")
    creator = relationship("User", back_populates="created_agents", foreign_keys=[created_by])
    chats = relationship("Chat", back_populates="agent", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_agents_team_id", "team_id"),
        Index("idx_agents_created_by", "created_by"),
        Index("idx_agents_team_active", "team_id", "is_active"),
    )

    def __repr__(self):
        return f"<Agent(id={self.id}, name={self.name}, team_id={self.team_id})>"


class Chat(Base):
    """
    Chat model with JSONB message storage (Open WebUI pattern).

    Stores entire conversation history as JSON array for simplicity.
    Perfect for small teams with 2-5 users.
    """
    __tablename__ = "chats"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    team_id = Column(UUID(as_uuid=True), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    agent_id = Column(UUID(as_uuid=True), ForeignKey("agents.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(Text, nullable=True)
    messages = Column(JSONB, nullable=False, default=[])
    chat_metadata = Column(JSONB, nullable=False, default={})
    is_archived = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    team = relationship("Team", back_populates="chats")
    user = relationship("User", back_populates="chats")
    agent = relationship("Agent", back_populates="chats")

    __table_args__ = (
        Index("idx_chats_team_id", "team_id"),
        Index("idx_chats_user_id", "user_id"),
        Index("idx_chats_agent_id", "agent_id"),
        Index("idx_chats_user_active", "user_id", "is_archived"),
        Index("idx_chats_created_at_desc", "created_at"),
        Index("idx_chats_messages_gin", "messages", postgresql_using="gin"),
        CheckConstraint("jsonb_typeof(messages) = 'array'", name="chats_messages_is_array"),
    )

    def __repr__(self):
        return f"<Chat(id={self.id}, title={self.title}, user_id={self.user_id})>"


class ErrorLog(Base):
    """
    Error logging model for debugging and monitoring.
    """
    __tablename__ = "error_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    team_id = Column(UUID(as_uuid=True), ForeignKey("teams.id", ondelete="SET NULL"), nullable=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    agent_id = Column(UUID(as_uuid=True), ForeignKey("agents.id", ondelete="SET NULL"), nullable=True)
    chat_id = Column(UUID(as_uuid=True), ForeignKey("chats.id", ondelete="SET NULL"), nullable=True)
    level = Column(Text, nullable=False, default="error")
    message = Column(Text, nullable=False)
    details = Column(JSONB, nullable=False, default={})
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_error_logs_team_id", "team_id"),
        Index("idx_error_logs_user_id", "user_id"),
        Index("idx_error_logs_level", "level"),
        Index("idx_error_logs_created_at_desc", "created_at"),
        Index("idx_error_logs_team_created", "team_id", "created_at"),
        CheckConstraint("level IN ('info', 'warning', 'error', 'critical')", name="error_logs_level_check"),
    )

    def __repr__(self):
        return f"<ErrorLog(id={self.id}, level={self.level}, message={self.message[:50]})>"
