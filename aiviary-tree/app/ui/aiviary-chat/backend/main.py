"""
FastAPI application entry point.

Security features:
- CORS configuration for frontend integration
- Security headers middleware
- Request logging (without sensitive data)
- Rate limiting protection
- Error handling without information leakage

Production considerations:
- Use HTTPS in production (secure cookies require it)
- Configure proper CORS origins
- Set up monitoring and logging
- Use environment variables for configuration
- Deploy behind reverse proxy (nginx/caddy)
"""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from database import init_db, get_db
from routers import auth as auth_router

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


# ============================================================================
# Application Lifespan Management
# ============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan manager.

    Handles:
    - Database initialization on startup
    - Cleanup on shutdown
    - Resource management
    """
    # Startup
    logger.info("Starting application...")

    # Initialize database tables
    try:
        await init_db()
        logger.info("Database initialized successfully")
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")
        raise

    yield  # Application runs here

    # Shutdown
    logger.info("Shutting down application...")


# ============================================================================
# FastAPI Application
# ============================================================================

app = FastAPI(
    title="FastAPI Authentication Service",
    description="""
    Production-ready JWT authentication system with httpOnly cookies.

    Features:
    - JWT-based authentication
    - httpOnly cookies for XSS protection
    - bcrypt password hashing (12 rounds)
    - Rate limiting on login
    - Secure password requirements
    - Refresh token support
    - CORS configuration

    Security:
    - All passwords hashed with bcrypt
    - JWT tokens in httpOnly cookies
    - SameSite=Strict for CSRF protection
    - Secure flag for HTTPS
    - Generic error messages to prevent enumeration
    """,
    version="1.0.0",
    docs_url="/docs",  # Swagger UI
    redoc_url="/redoc",  # ReDoc
    lifespan=lifespan,
)


# ============================================================================
# CORS Configuration
# ============================================================================

# Get allowed origins from environment or use defaults
ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,http://localhost:5173"  # React/Vite default ports
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,  # Frontend URLs
    allow_credentials=True,  # Required for cookies
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=[
        "Content-Type",
        "Authorization",
        "Accept",
        "Origin",
        "User-Agent",
    ],
    expose_headers=["Content-Length", "Content-Type"],
    max_age=3600,  # Cache preflight requests for 1 hour
)


# ============================================================================
# Security Headers Middleware
# ============================================================================

@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    """
    Add security headers to all responses.

    Headers added:
    - X-Content-Type-Options: Prevent MIME sniffing
    - X-Frame-Options: Prevent clickjacking
    - X-XSS-Protection: Enable XSS filter
    - Strict-Transport-Security: Enforce HTTPS
    - Content-Security-Policy: Restrict resource loading
    """
    response = await call_next(request)

    # Security headers
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"

    # HSTS - only in production with HTTPS
    if os.getenv("ENVIRONMENT") == "production":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

    # CSP - adjust based on your needs
    response.headers["Content-Security-Policy"] = "default-src 'self'"

    return response


# ============================================================================
# Request Logging Middleware
# ============================================================================

@app.middleware("http")
async def log_requests(request: Request, call_next):
    """
    Log all incoming requests.

    Security:
    - Does not log sensitive data (passwords, tokens)
    - Logs IP address for security monitoring
    - Logs response status for error tracking
    """
    # Log request
    logger.info(
        f"Request: {request.method} {request.url.path} "
        f"from {request.client.host}"
    )

    # Process request
    response = await call_next(request)

    # Log response
    logger.info(
        f"Response: {request.method} {request.url.path} "
        f"Status: {response.status_code}"
    )

    return response


# ============================================================================
# Exception Handlers
# ============================================================================

@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """
    Handle HTTP exceptions with consistent format.

    Security:
    - Returns generic error messages
    - Logs detailed errors server-side
    - Never exposes stack traces
    """
    logger.warning(
        f"HTTP {exc.status_code}: {exc.detail} "
        f"at {request.method} {request.url.path}"
    )

    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """
    Handle request validation errors.

    Security:
    - Returns detailed validation errors (safe to expose)
    - Helps clients fix malformed requests
    """
    logger.warning(
        f"Validation error at {request.method} {request.url.path}: "
        f"{exc.errors()}"
    )

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "detail": "Validation error",
            "errors": exc.errors(),
        },
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """
    Handle unexpected exceptions.

    Security:
    - Never expose internal error details to client
    - Log full error server-side for debugging
    - Return generic error message
    """
    logger.error(
        f"Unexpected error at {request.method} {request.url.path}: "
        f"{type(exc).__name__}: {str(exc)}",
        exc_info=True,  # Include traceback in logs
    )

    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "detail": "An unexpected error occurred. Please try again later."
        },
    )


# ============================================================================
# Router Registration
# ============================================================================

# Include routers
app.include_router(auth_router.router)

# Import and register agent and chat routers
from routers import agents as agents_router
from routers import chats as chats_router

app.include_router(agents_router.router)
app.include_router(chats_router.router)
app.include_router(chats_router.legacy_router)  # Legacy frontend compatibility endpoints


# ============================================================================
# Root Endpoint
# ============================================================================

@app.get(
    "/",
    tags=["root"],
    summary="API root endpoint",
    description="Returns API information and available endpoints",
)
async def root():
    """
    Root endpoint - API information.

    Public endpoint - no authentication required.
    """
    return {
        "message": "FastAPI Multi-Tenant Chat Service",
        "version": "1.0.0",
        "docs": "/docs",
        "redoc": "/redoc",
        "endpoints": {
            "auth": {
                "register": "POST /api/auth/register",
                "login": "POST /api/auth/login",
                "logout": "POST /api/auth/logout",
                "me": "GET /api/auth/me",
                "refresh": "POST /api/auth/refresh",
                "health": "GET /api/auth/health",
            },
            "agents": {
                "list": "GET /api/agents",
                "create": "POST /api/agents",
                "get": "GET /api/agents/{id}",
                "update": "PUT /api/agents/{id}",
                "delete": "DELETE /api/agents/{id}",
                "avatar": "POST /api/agents/{id}/avatar",
            },
            "chats": {
                "list": "GET /api/chats",
                "create": "POST /api/chats",
                "get": "GET /api/chats/{id}",
                "update": "PUT /api/chats/{id}",
                "delete": "DELETE /api/chats/{id}",
                "send_message": "POST /api/chats/{id}/messages",
            },
        },
    }


# ============================================================================
# Health Check
# ============================================================================

@app.get(
    "/health",
    tags=["health"],
    summary="Application health check",
    description="Check if application is running and database is accessible",
)
async def health_check():
    """
    Health check endpoint for monitoring.

    Checks:
    - Application is running
    - Database connection is healthy

    Public endpoint - no authentication required.
    """
    try:
        # Test database connection
        from sqlalchemy import text
        async for db in get_db():
            await db.execute(text("SELECT 1"))

        return {
            "status": "healthy",
            "database": "connected",
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "status": "unhealthy",
                "database": "disconnected",
            },
        )


# ============================================================================
# Development Server
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    import os
    from dotenv import load_dotenv

    # Load environment variables
    load_dotenv()

    # Development server configuration
    # In production, use gunicorn with uvicorn workers:
    # gunicorn main:app -w 4 -k uvicorn.workers.UvicornWorker -b 0.0.0.0:8000

    port = int(os.getenv("PORT", "8001"))
    host = os.getenv("HOST", "0.0.0.0")

    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=True,  # Auto-reload on code changes (development only)
        log_level="info",
    )
