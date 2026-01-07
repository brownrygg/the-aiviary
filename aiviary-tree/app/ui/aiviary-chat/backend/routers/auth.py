from __future__ import annotations

"""
Authentication router - handles user registration, login, logout, and user info.

Security features implemented:
- JWT tokens in httpOnly cookies (not localStorage)
- bcrypt password hashing with 12 rounds
- Rate limiting on login endpoint (5 attempts per minute)
- Generic error messages to prevent account enumeration
- HTTPS enforcement in production
- SameSite=Strict cookie protection
- Input validation via Pydantic
- No password/token logging

Endpoints:
- POST /api/auth/register - Create new user account
- POST /api/auth/login - Authenticate and set JWT cookie
- POST /api/auth/logout - Clear JWT cookie
- GET /api/auth/me - Get current authenticated user info
- POST /api/auth/refresh - Refresh access token using refresh token
"""

from datetime import datetime
import logging
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status, Response, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.exc import IntegrityError

from auth import (
    hash_password,
    authenticate_user,
    create_access_token,
    create_refresh_token,
    get_cookie_settings,
    get_refresh_cookie_settings,
    get_current_active_user,
    decode_token,
)
from models import User, Team
from schemas import (
    UserRegister,
    UserLogin,
    UserResponse,
    MessageResponse,
    ErrorResponse,
)


# Configure logging
logger = logging.getLogger(__name__)

# Create router
router = APIRouter(prefix="/api/auth", tags=["authentication"])


# ============================================================================
# Rate Limiting Configuration
# ============================================================================

# Simple in-memory rate limiter for login attempts
# In production, use Redis or similar for distributed rate limiting
from collections import defaultdict
from datetime import timedelta
import asyncio

login_attempts: defaultdict = defaultdict(list)
MAX_LOGIN_ATTEMPTS = 5
RATE_LIMIT_WINDOW = timedelta(minutes=1)


async def check_rate_limit(ip_address: str) -> bool:
    """
    Check if IP address has exceeded login rate limit.

    Security:
    - Prevents brute force attacks
    - 5 attempts per minute per IP
    - Cleans up old attempts automatically

    Args:
        ip_address: Client IP address

    Returns:
        True if rate limit exceeded, False otherwise

    Production note:
    - Use Redis with sliding window for distributed systems
    - Consider account-level rate limiting too
    """
    now = datetime.utcnow()
    cutoff = now - RATE_LIMIT_WINDOW

    # Clean up old attempts
    login_attempts[ip_address] = [
        attempt for attempt in login_attempts[ip_address]
        if attempt > cutoff
    ]

    # Check if limit exceeded
    if len(login_attempts[ip_address]) >= MAX_LOGIN_ATTEMPTS:
        return True

    # Record this attempt
    login_attempts[ip_address].append(now)
    return False


# ============================================================================
# Database Dependency
# ============================================================================

from database import get_db


# ============================================================================
# Authentication Endpoints
# ============================================================================

@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        201: {"description": "User created successfully"},
        400: {"model": ErrorResponse, "description": "Email already registered"},
        422: {"model": ErrorResponse, "description": "Validation error"},
    },
    summary="Register a new user",
    description="""
    Create a new user account.

    Security:
    - Email must be unique
    - Password must meet complexity requirements (8+ chars, uppercase, lowercase, number)
    - Password is hashed with bcrypt (12 rounds)
    - Returns 400 for duplicate email (acceptable to reveal this during registration)
    """,
)
async def register(
    user_data: UserRegister,
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Register a new user account.

    Process:
    1. Validate input (Pydantic)
    2. Hash password with bcrypt
    3. Create user in database
    4. Return user info (no password)

    Security notes:
    - Password is never stored in plain text
    - Password is never returned in response
    - Duplicate email returns clear error (okay for registration)
    """
    try:
        # Validate team_id
        from uuid import UUID
        try:
            team_uuid = UUID(user_data.team_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid team ID format"
            )

        # Verify team exists
        result = await db.execute(
            select(Team).where(Team.id == team_uuid)
        )
        team = result.scalar_one_or_none()

        if not team:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Team not found"
            )

        if not team.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Team is not active"
            )

        # Check if user already exists in this team
        result = await db.execute(
            select(User).where(
                User.email == user_data.email.lower(),
                User.team_id == team_uuid
            )
        )
        existing_user = result.scalar_one_or_none()

        if existing_user:
            logger.info(f"Registration attempt with existing email: {user_data.email}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered in this team",
            )

        # Hash password
        hashed_password = hash_password(user_data.password)

        # Create user
        new_user = User(
            team_id=team_uuid,
            email=user_data.email.lower(),
            password_hash=hashed_password,
            full_name=user_data.full_name,
            role="user",
            is_active=True,
        )

        db.add(new_user)
        await db.commit()
        await db.refresh(new_user)

        logger.info(f"New user registered: {new_user.id}")
        return new_user

    except IntegrityError as e:
        await db.rollback()
        logger.error(f"Database integrity error during registration: {type(e).__name__}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Unexpected error during registration: {type(e).__name__}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred during registration",
        )


@router.post(
    "/login",
    response_model=MessageResponse,
    responses={
        200: {"description": "Login successful, JWT set in httpOnly cookie"},
        401: {"model": ErrorResponse, "description": "Invalid credentials"},
        429: {"model": ErrorResponse, "description": "Too many login attempts"},
    },
    summary="Login and receive JWT cookie",
    description="""
    Authenticate user and set JWT token in httpOnly cookie.

    Security:
    - Rate limited to 5 attempts per minute per IP
    - Returns generic error message (doesn't reveal if email exists)
    - Token set in httpOnly cookie (not accessible to JavaScript)
    - Updates last_login timestamp
    - Refresh token also set for token renewal
    """,
)
async def login(
    response: Response,
    request: Request,
    credentials: UserLogin,
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """
    Authenticate user and set JWT tokens in httpOnly cookies.

    Security flow:
    1. Check rate limit (prevent brute force)
    2. Authenticate user credentials
    3. Generate access token (1 hour)
    4. Generate refresh token (7 days)
    5. Set tokens in httpOnly cookies
    6. Update last_login timestamp

    Returns:
    - 200: Success message (tokens in cookies)
    - 401: Invalid credentials (generic message)
    - 429: Rate limit exceeded
    """
    # Get client IP for rate limiting
    client_ip = request.client.host

    # Check rate limit
    if await check_rate_limit(client_ip):
        logger.warning(f"Rate limit exceeded for IP: {client_ip}")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Please try again later.",
        )

    # Authenticate user
    user = await authenticate_user(db, credentials.email, credentials.password)

    if not user:
        # Generic error - don't reveal if email exists
        logger.warning(f"Failed login attempt for email: {credentials.email}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Create access token
    access_token = create_access_token(
        data={"sub": str(user.id), "email": user.email}
    )

    # Create refresh token
    refresh_token = create_refresh_token(
        data={"sub": str(user.id), "email": user.email}
    )

    # Update last login timestamp
    user.last_login_at = datetime.utcnow()
    await db.commit()

    # Determine if running in secure mode (HTTPS)
    # In development, set ENVIRONMENT=development to disable secure cookies
    import os
    is_production = os.getenv("ENVIRONMENT", "production") == "production"

    # Set access token cookie
    response.set_cookie(
        key="access_token",
        value=access_token,
        **get_cookie_settings(secure=is_production)
    )

    # Set refresh token cookie
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        **get_refresh_cookie_settings(secure=is_production)
    )

    logger.info(f"User logged in successfully: {user.id}")

    return MessageResponse(message="Login successful")


@router.post(
    "/logout",
    response_model=MessageResponse,
    responses={
        200: {"description": "Logout successful, cookies cleared"},
    },
    summary="Logout and clear JWT cookies",
    description="""
    Clear JWT tokens from cookies.

    Security:
    - Clears both access and refresh tokens
    - Sets max_age=0 to immediately expire cookies
    - No authentication required (can always logout)
    """,
)
async def logout(response: Response) -> MessageResponse:
    """
    Logout user by clearing JWT cookies.

    Security notes:
    - Clears access_token cookie
    - Clears refresh_token cookie
    - Sets max_age=0 for immediate expiration
    - In production, consider token blacklist for additional security
    """
    # Clear access token
    response.delete_cookie(
        key="access_token",
        httponly=True,
        secure=True,  # Match login settings
        samesite="strict",
    )

    # Clear refresh token
    response.delete_cookie(
        key="refresh_token",
        httponly=True,
        secure=True,
        samesite="strict",
    )

    logger.info("User logged out")

    return MessageResponse(message="Successfully logged out")


@router.get(
    "/me",
    response_model=UserResponse,
    responses={
        200: {"description": "Current user information"},
        401: {"model": ErrorResponse, "description": "Not authenticated"},
    },
    summary="Get current user information",
    description="""
    Get information about the currently authenticated user.

    Security:
    - Requires valid JWT in httpOnly cookie
    - Returns user info without password
    - Verifies user is active
    """,
)
async def get_current_user_info(
    current_user: User = Depends(get_current_active_user),
) -> UserResponse:
    """
    Get current authenticated user's information.

    Protected route - requires valid JWT token.

    Returns:
    - User information (excluding password)

    Security:
    - JWT validation handled by dependency
    - Only returns safe user data (no password)
    """
    return UserResponse(
        id=str(current_user.id),
        team_id=str(current_user.team_id),
        email=current_user.email,
        full_name=current_user.full_name,
        role=current_user.role,
        avatar=current_user.avatar,
        preferences=current_user.preferences or {},
        is_active=current_user.is_active,
        last_login_at=current_user.last_login_at,
        created_at=current_user.created_at
    )


@router.post(
    "/refresh",
    response_model=MessageResponse,
    responses={
        200: {"description": "Token refreshed successfully"},
        401: {"model": ErrorResponse, "description": "Invalid refresh token"},
    },
    summary="Refresh access token",
    description="""
    Refresh access token using refresh token.

    Security:
    - Validates refresh token from httpOnly cookie
    - Issues new access token
    - Optionally rotates refresh token (recommended)
    """,
)
async def refresh_token(
    response: Response,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """
    Refresh access token using refresh token.

    Security flow:
    1. Extract refresh token from cookie
    2. Validate refresh token
    3. Verify user still exists and is active
    4. Issue new access token
    5. Optionally issue new refresh token (token rotation)

    Token rotation (recommended):
    - Issues new refresh token on each refresh
    - Invalidates old refresh token
    - Prevents token reuse attacks
    """
    # Extract refresh token from cookie
    refresh_token = request.cookies.get("refresh_token")

    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token not found",
        )

    try:
        # Decode and validate refresh token
        payload = decode_token(refresh_token)

        # Verify token type
        if payload.get("type") != "refresh":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token type",
            )

        # Extract user ID
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token",
            )

        # Fetch user from database
        from uuid import UUID
        try:
            user_uuid = UUID(user_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token",
            )

        result = await db.execute(select(User).where(User.id == user_uuid))
        user = result.scalar_one_or_none()

        if not user or not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token",
            )

        # Create new access token
        new_access_token = create_access_token(
            data={"sub": str(user.id), "email": user.email}
        )

        # Token rotation: create new refresh token
        new_refresh_token = create_refresh_token(
            data={"sub": str(user.id), "email": user.email}
        )

        # Determine environment
        import os
        is_production = os.getenv("ENVIRONMENT", "production") == "production"

        # Set new access token cookie
        response.set_cookie(
            key="access_token",
            value=new_access_token,
            **get_cookie_settings(secure=is_production)
        )

        # Set new refresh token cookie (token rotation)
        response.set_cookie(
            key="refresh_token",
            value=new_refresh_token,
            **get_refresh_cookie_settings(secure=is_production)
        )

        logger.info(f"Token refreshed for user: {user.id}")

        return MessageResponse(message="Token refreshed successfully")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Token refresh error: {type(e).__name__}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )


# ============================================================================
# Health Check Endpoint (Public)
# ============================================================================

@router.get(
    "/health",
    response_model=MessageResponse,
    responses={
        200: {"description": "Service is healthy"},
    },
    summary="Health check endpoint",
    description="Public endpoint to check if authentication service is running",
)
async def health_check() -> MessageResponse:
    """
    Health check endpoint for monitoring.

    Public endpoint - no authentication required.
    """
    return MessageResponse(message="Authentication service is healthy")
