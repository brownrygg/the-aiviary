"""
JWT authentication utilities and password hashing functions.

Security implementation:
- bcrypt with 12 rounds minimum for password hashing
- JWT tokens with short expiration (1 hour)
- Refresh tokens with longer expiration (7 days)
- httpOnly cookies to prevent XSS attacks
- Secure flag for HTTPS enforcement
- SameSite=Strict for CSRF protection
- No logging of passwords or tokens

CRITICAL SECURITY NOTES:
- Never log password hashes or JWT tokens
- Always validate JWT signature and expiration
- Use constant-time comparison for password verification
- Rotate JWT secrets regularly in production
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional, Dict, Any
import logging
import os

from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from models import User
from database import get_db

# Configure logging - NEVER log passwords or tokens
logger = logging.getLogger(__name__)


# ============================================================================
# Configuration
# ============================================================================

# JWT Configuration
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "CHANGE_THIS_IN_PRODUCTION_USE_OPENSSL_RAND_HEX_32")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60  # 1 hour
REFRESH_TOKEN_EXPIRE_DAYS = 7  # 7 days

# Password hashing configuration
# bcrypt with 12 rounds minimum (OWASP recommendation)
pwd_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto",
    bcrypt__rounds=12,  # Minimum 12 rounds for security
)

# Bearer token security
security = HTTPBearer(auto_error=False)


# ============================================================================
# Password Hashing Functions
# ============================================================================

def hash_password(password: str) -> str:
    """
    Hash a password using bcrypt with 12+ rounds.

    Security considerations:
    - Uses bcrypt algorithm (designed for password hashing)
    - 12 rounds minimum (OWASP recommendation)
    - Automatic salt generation
    - Resistant to rainbow table attacks

    Args:
        password: Plain text password to hash

    Returns:
        Hashed password string

    SECURITY WARNING:
    - Never log the password parameter
    - Never store plain text passwords
    """
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verify a password against its hash using constant-time comparison.

    Security considerations:
    - Constant-time comparison prevents timing attacks
    - Automatic hash upgrade if algorithm is updated
    - Returns False on any error to prevent information leakage

    Args:
        plain_password: Plain text password to verify
        hashed_password: Hashed password from database

    Returns:
        True if password matches, False otherwise

    SECURITY WARNING:
    - Never log password parameters
    - Always use generic error messages
    """
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except Exception as e:
        # Log error without exposing password data
        logger.error(f"Password verification error: {type(e).__name__}")
        return False


# ============================================================================
# JWT Token Functions
# ============================================================================

def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """
    Create a JWT access token.

    Security considerations:
    - Short expiration time (1 hour default)
    - Includes expiration timestamp
    - Includes issued-at timestamp for audit
    - Uses HS256 algorithm (HMAC with SHA-256)

    Args:
        data: Dictionary of claims to encode in token
        expires_delta: Optional custom expiration time

    Returns:
        Encoded JWT token string

    Token structure:
    {
        "sub": user_id,
        "email": user_email,
        "exp": expiration_timestamp,
        "iat": issued_at_timestamp
    }

    SECURITY WARNING:
    - Never log the returned token
    - Never include sensitive data in payload (it's not encrypted)
    - Token signature prevents tampering but payload is readable
    """
    to_encode = data.copy()

    # Set expiration time
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    # Add standard JWT claims
    to_encode.update({
        "exp": expire,
        "iat": datetime.utcnow(),
    })

    # Encode token
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def create_refresh_token(data: Dict[str, Any]) -> str:
    """
    Create a JWT refresh token with longer expiration.

    Security considerations:
    - Longer expiration (7 days) for better UX
    - Should be stored in httpOnly cookie
    - Can be revoked by maintaining token blacklist (not implemented here)

    Args:
        data: Dictionary of claims to encode in token

    Returns:
        Encoded JWT refresh token string

    SECURITY WARNING:
    - Never log the returned token
    - Implement token rotation in production
    - Consider token blacklist for revocation
    """
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)

    to_encode.update({
        "exp": expire,
        "iat": datetime.utcnow(),
        "type": "refresh"  # Mark as refresh token
    })

    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def decode_token(token: str) -> Dict[str, Any]:
    """
    Decode and validate a JWT token.

    Security considerations:
    - Validates signature to prevent tampering
    - Validates expiration to prevent replay attacks
    - Raises exception on any validation failure

    Args:
        token: JWT token string to decode

    Returns:
        Decoded token payload

    Raises:
        JWTError: If token is invalid, expired, or tampered

    SECURITY WARNING:
    - Never log the token parameter
    - Always validate token before trusting payload
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError as e:
        # Log error type without exposing token
        logger.warning(f"JWT decode error: {type(e).__name__}")
        raise


# ============================================================================
# Cookie Configuration
# ============================================================================

def get_cookie_settings(secure: bool = True) -> Dict[str, Any]:
    """
    Get secure cookie settings for JWT tokens.

    Security settings:
    - httponly: Prevents JavaScript access (XSS protection)
    - secure: HTTPS only (set to False in development)
    - samesite: 'strict' prevents CSRF attacks
    - max_age: Auto-expire cookies with token

    Args:
        secure: Whether to enforce HTTPS (True in production)

    Returns:
        Dictionary of cookie settings
    """
    return {
        "httponly": True,  # Prevents XSS attacks
        "secure": secure,  # HTTPS only (set False for local dev)
        "samesite": "strict",  # Prevents CSRF attacks
        "max_age": ACCESS_TOKEN_EXPIRE_MINUTES * 60,  # Seconds
    }


def get_refresh_cookie_settings(secure: bool = True) -> Dict[str, Any]:
    """Get cookie settings for refresh tokens."""
    return {
        "httponly": True,
        "secure": secure,
        "samesite": "strict",
        "max_age": REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,  # Seconds
    }


# ============================================================================
# Authentication Dependencies
# ============================================================================

async def get_current_user_from_cookie(
    request: Request,
    db: "AsyncSession" = Depends(get_db),
) -> User:
    """
    Extract and validate JWT from httpOnly cookie, return current user.

    Security flow:
    1. Extract token from httpOnly cookie
    2. Validate JWT signature and expiration
    3. Extract user ID from token payload
    4. Fetch user from database
    5. Verify user is active

    Args:
        request: FastAPI request object
        db: Database session

    Returns:
        Authenticated User object

    Raises:
        HTTPException: 401 if token invalid or user not found

    SECURITY WARNING:
    - Never log token values
    - Use generic error messages to prevent information leakage
    """
    # Extract token from cookie
    token = request.cookies.get("access_token")

    if not token:
        logger.warning("Missing access token in cookies")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        # Decode and validate token
        payload = decode_token(token)

        # Extract user identifier
        user_id: str = payload.get("sub")
        if user_id is None:
            logger.warning("Token missing 'sub' claim")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication credentials",
            )

        # Fetch user from database
        from uuid import UUID
        try:
            user_uuid = UUID(user_id)
        except ValueError:
            logger.warning("Invalid UUID in token")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication credentials",
            )

        result = await db.execute(select(User).where(User.id == user_uuid))
        user = result.scalar_one_or_none()

        if user is None:
            logger.warning(f"User not found for ID in token")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication credentials",
            )

        # Verify user is active
        if not user.is_active:
            logger.warning(f"Inactive user attempted access: {user.id}")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Inactive user account",
            )

        return user

    except JWTError as e:
        logger.warning(f"JWT validation error: {type(e).__name__}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_current_user_from_header(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(),
) -> User:
    """
    Extract and validate JWT from Authorization header.

    Use this for API clients that can't use cookies (mobile apps, etc.)

    Security flow: Same as get_current_user_from_cookie but uses header

    Args:
        credentials: Bearer token from Authorization header
        db: Database session

    Returns:
        Authenticated User object

    Raises:
        HTTPException: 401 if token invalid or user not found
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials

    try:
        payload = decode_token(token)
        user_id: str = payload.get("sub")

        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication credentials",
            )

        from uuid import UUID
        try:
            user_uuid = UUID(user_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication credentials",
            )

        result = await db.execute(select(User).where(User.id == user_uuid))
        user = result.scalar_one_or_none()

        if user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication credentials",
            )

        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Inactive user account",
            )

        return user

    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_current_active_user(
    current_user: User = Depends(get_current_user_from_cookie),
) -> User:
    """
    Dependency for routes requiring an active user.

    Args:
        current_user: User from get_current_user_from_cookie

    Returns:
        Active User object

    Raises:
        HTTPException: 403 if user is inactive
    """
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive user account",
        )
    return current_user


async def get_current_superuser(
    current_user: User = Depends(get_current_active_user),
) -> User:
    """
    Dependency for routes requiring superuser privileges.

    Use this for admin-only endpoints.

    Args:
        current_user: User from get_current_active_user

    Returns:
        Superuser User object

    Raises:
        HTTPException: 403 if user is not a superuser
    """
    if not current_user.is_superuser:
        logger.warning(f"Non-superuser attempted admin access: {current_user.id}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions",
        )
    return current_user


# ============================================================================
# User Authentication Helper
# ============================================================================

async def authenticate_user(db: AsyncSession, email: str, password: str) -> Optional[User]:
    """
    Authenticate a user by email and password.

    Security considerations:
    - Uses constant-time password comparison
    - Returns None on failure (generic error to client)
    - Checks user is active before returning
    - No indication of whether email exists (prevents enumeration)

    Args:
        db: Database session
        email: User's email address
        password: Plain text password

    Returns:
        User object if authentication successful, None otherwise

    SECURITY WARNING:
    - Never log password parameter
    - Return None for both "user not found" and "wrong password"
    - This prevents account enumeration attacks
    """
    try:
        # Fetch user by email
        result = await db.execute(
            select(User).where(User.email == email.lower().strip())
        )
        user = result.scalar_one_or_none()

        # User not found - return None without indication
        if user is None:
            # Run password hash anyway to prevent timing attacks
            pwd_context.hash("dummy_password")
            return None

        # Verify password
        if not verify_password(password, user.password_hash):
            return None

        # Check if user is active
        if not user.is_active:
            logger.warning(f"Inactive user login attempt: {email}")
            return None

        return user

    except Exception as e:
        # Log error without exposing sensitive data
        logger.error(f"Authentication error: {type(e).__name__}")
        return None
