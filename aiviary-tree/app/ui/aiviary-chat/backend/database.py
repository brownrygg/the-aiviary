"""
Database configuration and session management.

This module handles:
- Async SQLAlchemy engine setup
- Database session factory
- Dependency injection for FastAPI routes
- Database initialization and migrations

Security considerations:
- Database credentials from environment variables
- Connection pooling for performance
- Async operations for better concurrency
"""

import os
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import declarative_base

# Database URL from environment variable
# Format: postgresql+asyncpg://user:password@host:port/database
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://user:password@localhost:5432/app_db"
)

# Create async engine
# echo=True enables SQL query logging (disable in production)
engine = create_async_engine(
    DATABASE_URL,
    echo=False,  # Set to True for development SQL logging
    future=True,
    pool_pre_ping=True,  # Verify connections before using
    pool_size=10,  # Connection pool size
    max_overflow=20,  # Additional connections when pool is full
)

# Create async session factory
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,  # Don't expire objects after commit
    autocommit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Database session dependency for FastAPI routes.

    Usage:
        @app.get("/items")
        async def get_items(db: AsyncSession = Depends(get_db)):
            result = await db.execute(select(Item))
            return result.scalars().all()

    Features:
    - Automatic session management
    - Automatic cleanup on error
    - Async context manager support
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db() -> None:
    """
    Initialize database tables.

    Creates all tables defined in models.py if they don't exist.

    Note: In production, use Alembic for migrations instead of this function.

    Usage:
        await init_db()  # Call on app startup
    """
    from models import Base

    async with engine.begin() as conn:
        # Create all tables
        await conn.run_sync(Base.metadata.create_all)


async def drop_db() -> None:
    """
    Drop all database tables.

    WARNING: This will delete all data!
    Only use in development/testing.

    Usage:
        await drop_db()  # Be very careful!
    """
    from models import Base

    async with engine.begin() as conn:
        # Drop all tables
        await conn.run_sync(Base.metadata.drop_all)
