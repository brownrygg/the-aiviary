# Project Structure

Complete overview of the FastAPI authentication system.

## Directory Tree

```
backend/
├── main.py                  # FastAPI application entry point
├── database.py             # Database configuration and session management
├── models.py               # SQLAlchemy User model
├── schemas.py              # Pydantic validation models
├── auth.py                 # JWT utilities and password hashing
│
├── routers/                # API route modules
│   ├── __init__.py
│   └── auth.py             # Authentication endpoints
│
├── requirements.txt        # Python dependencies
├── .env.example           # Environment configuration template
├── .gitignore             # Git ignore rules
│
├── README.md              # Complete documentation
├── QUICK_START.md         # Quick start guide
├── PROJECT_STRUCTURE.md   # This file
│
├── create_superuser.py    # Utility: Create admin user
├── test_setup.py          # Utility: Verify setup
└── run.sh                 # Utility: Quick start script
```

## File Descriptions

### Core Application Files

#### `main.py`
**Purpose**: FastAPI application entry point

**Contains**:
- FastAPI app initialization
- CORS middleware configuration
- Security headers middleware
- Request logging middleware
- Exception handlers
- Router registration
- Health check endpoints
- Lifespan management (startup/shutdown)

**Key Features**:
- Production-ready middleware stack
- Comprehensive error handling
- Security headers (XSS, clickjacking, MIME-sniffing protection)
- Request/response logging
- Health check for monitoring

**Usage**:
```bash
uvicorn main:app --reload  # Development
gunicorn main:app -w 4 -k uvicorn.workers.UvicornWorker  # Production
```

---

#### `database.py`
**Purpose**: Database configuration and session management

**Contains**:
- Async SQLAlchemy engine setup
- Database session factory
- Dependency for FastAPI routes
- Database initialization functions

**Key Features**:
- Async database operations
- Connection pooling
- Automatic session cleanup
- PostgreSQL with asyncpg driver

**Usage**:
```python
from database import get_db

@app.get("/items")
async def get_items(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Item))
    return result.scalars().all()
```

---

#### `models.py`
**Purpose**: SQLAlchemy database models

**Contains**:
- User model with all fields
- Database indexes
- Field validators
- Audit timestamps

**User Model Fields**:
- `id`: Primary key
- `email`: Unique, indexed
- `hashed_password`: bcrypt hash
- `full_name`: Optional user name
- `is_active`: Soft delete flag
- `is_superuser`: Admin flag
- `created_at`: Account creation timestamp
- `updated_at`: Last update timestamp
- `last_login`: Last login timestamp

**Security Features**:
- Email normalization (lowercase)
- Password never stored in plain text
- Indexed fields for performance
- Composite indexes for common queries

---

#### `schemas.py`
**Purpose**: Pydantic models for validation and serialization

**Contains**:

**Request Models** (Input):
- `UserRegister`: Registration data validation
- `UserLogin`: Login credentials validation
- `UserUpdate`: User update validation
- `PasswordChange`: Password change validation

**Response Models** (Output):
- `UserResponse`: User data (no password)
- `TokenResponse`: JWT token response
- `MessageResponse`: Generic message response
- `ErrorResponse`: Error response format

**Security Features**:
- Email validation
- Password complexity requirements
- Input sanitization
- No sensitive data in responses

---

#### `auth.py`
**Purpose**: Authentication utilities

**Contains**:

**Password Functions**:
- `hash_password()`: bcrypt hashing (12 rounds)
- `verify_password()`: Constant-time verification

**JWT Functions**:
- `create_access_token()`: Create access token (1 hour)
- `create_refresh_token()`: Create refresh token (7 days)
- `decode_token()`: Validate and decode tokens

**Cookie Functions**:
- `get_cookie_settings()`: Access token cookie config
- `get_refresh_cookie_settings()`: Refresh token cookie config

**Dependencies**:
- `get_current_user_from_cookie()`: Extract user from cookie
- `get_current_user_from_header()`: Extract user from header
- `get_current_active_user()`: Verify user is active
- `get_current_superuser()`: Verify user is admin

**Helper Functions**:
- `authenticate_user()`: Validate credentials

**Security Features**:
- httpOnly cookies
- Secure flag for HTTPS
- SameSite=Strict
- No logging of passwords/tokens
- Constant-time comparisons
- Generic error messages

---

### Router Files

#### `routers/auth.py`
**Purpose**: Authentication API endpoints

**Endpoints**:

1. **POST `/api/auth/register`**
   - Create new user account
   - Validates email uniqueness
   - Hashes password
   - Returns user info (no password)

2. **POST `/api/auth/login`**
   - Authenticate user
   - Rate limited (5/minute per IP)
   - Sets JWT cookies
   - Updates last_login
   - Generic error messages

3. **POST `/api/auth/logout`**
   - Clears JWT cookies
   - No authentication required

4. **GET `/api/auth/me`**
   - Returns current user info
   - Requires authentication
   - No password in response

5. **POST `/api/auth/refresh`**
   - Refreshes access token
   - Uses refresh token
   - Token rotation (optional)

6. **GET `/api/auth/health`**
   - Health check endpoint
   - No authentication required

**Security Features**:
- Rate limiting on login
- Generic error messages
- httpOnly cookie management
- Input validation
- No sensitive data logging

---

### Configuration Files

#### `requirements.txt`
**Purpose**: Python package dependencies

**Core Packages**:
- `fastapi`: Web framework
- `uvicorn`: ASGI server
- `sqlalchemy`: ORM
- `asyncpg`: PostgreSQL driver
- `python-jose`: JWT handling
- `passlib`: Password hashing
- `pydantic`: Data validation

**Optional Packages**:
- `alembic`: Database migrations
- `gunicorn`: Production server
- `python-dotenv`: Environment variables

---

#### `.env.example`
**Purpose**: Environment configuration template

**Variables**:
- `ENVIRONMENT`: development/production
- `DATABASE_URL`: PostgreSQL connection
- `JWT_SECRET_KEY`: Secret for JWT signing
- `ALLOWED_ORIGINS`: CORS allowed origins
- `ACCESS_TOKEN_EXPIRE_MINUTES`: Token expiry
- `REFRESH_TOKEN_EXPIRE_DAYS`: Refresh token expiry

**Usage**:
```bash
cp .env.example .env
# Edit .env with your values
```

---

#### `.gitignore`
**Purpose**: Git ignore rules

**Ignores**:
- Python cache files
- Virtual environments
- `.env` files (secrets)
- IDE files
- Database files
- Log files

---

### Utility Scripts

#### `create_superuser.py`
**Purpose**: Create admin user interactively

**Features**:
- Interactive prompts
- Password validation
- Duplicate email check
- Creates superuser account

**Usage**:
```bash
python create_superuser.py
```

---

#### `test_setup.py`
**Purpose**: Verify system setup

**Tests**:
- Environment variables
- Package imports
- Database connection
- Password hashing
- JWT token creation

**Usage**:
```bash
python test_setup.py
```

**Output**:
- Detailed check results
- Error troubleshooting
- Setup verification

---

#### `run.sh`
**Purpose**: Quick start script

**Features**:
- Creates .env if missing
- Sets up virtual environment
- Installs dependencies
- Runs verification
- Starts server

**Usage**:
```bash
chmod +x run.sh
./run.sh
```

---

### Documentation Files

#### `README.md`
**Purpose**: Complete documentation

**Sections**:
- Features overview
- Installation guide
- Usage examples
- Frontend integration
- Security best practices
- Deployment guide
- Troubleshooting
- API documentation

---

#### `QUICK_START.md`
**Purpose**: Get started in 5 minutes

**Sections**:
- One-command setup
- Manual setup steps
- Testing instructions
- Common issues
- Quick reference

---

## Data Flow

### Registration Flow
```
Client
  ↓ POST /api/auth/register {email, password}
Pydantic Validation (schemas.py)
  ↓ UserRegister model validates input
Auth Service (routers/auth.py)
  ↓ Check email uniqueness
  ↓ Hash password (auth.py)
Database (models.py)
  ↓ Create User record
Response
  ↓ UserResponse (no password)
Client
```

### Login Flow
```
Client
  ↓ POST /api/auth/login {email, password}
Rate Limiter
  ↓ Check 5/minute limit
Auth Service (routers/auth.py)
  ↓ authenticate_user()
Password Verification (auth.py)
  ↓ Constant-time comparison
JWT Creation (auth.py)
  ↓ create_access_token()
  ↓ create_refresh_token()
Response
  ↓ Set httpOnly cookies
  ↓ Update last_login
Client
  ↓ Receives cookies automatically
```

### Protected Route Flow
```
Client
  ↓ GET /api/auth/me (with cookies)
Dependency (auth.py)
  ↓ get_current_user_from_cookie()
  ↓ Extract token from cookie
  ↓ Decode and validate JWT
Database
  ↓ Fetch user by ID from token
  ↓ Verify user is active
Route Handler
  ↓ Process request with authenticated user
Response
  ↓ UserResponse
Client
```

## Security Architecture

### Defense Layers

1. **Input Validation**
   - Pydantic models validate all inputs
   - Email format validation
   - Password complexity requirements
   - Type checking

2. **Authentication**
   - bcrypt password hashing (12 rounds)
   - JWT with signature verification
   - Token expiration enforcement
   - httpOnly cookies (XSS protection)

3. **Authorization**
   - Active user checks
   - Superuser role checks
   - Route-level dependencies
   - Generic error messages

4. **Network Security**
   - CORS configuration
   - HTTPS enforcement (production)
   - SameSite cookies (CSRF protection)
   - Security headers

5. **Rate Limiting**
   - Login attempts (5/minute per IP)
   - Prevents brute force attacks

6. **Data Protection**
   - Passwords never stored in plain text
   - Tokens never logged
   - Sensitive data not in responses
   - Database connection encryption

## Extension Points

### Adding New User Fields

1. Update `models.py`:
```python
class User(Base):
    # ... existing fields ...
    phone_number = Column(String(20), nullable=True)
```

2. Update `schemas.py`:
```python
class UserResponse(BaseModel):
    # ... existing fields ...
    phone_number: Optional[str]
```

3. Run migration (Alembic) or reinit database

### Adding Protected Routes

```python
from auth import get_current_active_user
from models import User

@router.get("/protected")
async def protected_route(
    current_user: User = Depends(get_current_active_user)
):
    return {"message": f"Hello {current_user.email}"}
```

### Adding Admin-Only Routes

```python
from auth import get_current_superuser

@router.get("/admin")
async def admin_route(
    admin: User = Depends(get_current_superuser)
):
    return {"message": "Admin access granted"}
```

## Best Practices

### Development
- Use `.env` for configuration
- Enable SQL logging for debugging
- Use `--reload` for auto-restart
- Test with Swagger UI at `/docs`

### Production
- Set `ENVIRONMENT=production`
- Use strong JWT secret (32+ bytes)
- Enable HTTPS
- Use Gunicorn with workers
- Set up monitoring
- Use database migrations (Alembic)
- Implement token blacklist
- Add logging and alerting

### Security
- Never commit `.env`
- Rotate JWT secrets regularly
- Use strong database passwords
- Enable database SSL
- Monitor failed login attempts
- Keep dependencies updated
- Review security headers
- Implement rate limiting everywhere

## Troubleshooting

### Common Issues

**Database Connection Errors**
- Check PostgreSQL is running
- Verify DATABASE_URL format
- Ensure database exists
- Check user permissions

**Authentication Fails**
- Verify cookies are sent (`credentials: 'include'`)
- Check CORS configuration
- Ensure tokens not expired
- Verify JWT secret matches

**CORS Errors**
- Add frontend URL to ALLOWED_ORIGINS
- Check `allow_credentials=True`
- Verify request includes credentials

## Performance Considerations

### Database
- Connection pooling configured
- Indexed fields for queries
- Async operations throughout
- Proper session management

### Application
- Async/await for I/O operations
- Middleware stack optimized
- Static token validation (no DB hit)
- Efficient password hashing

### Scaling
- Stateless design (scales horizontally)
- JWT tokens (no session store)
- Database connection pooling
- Gunicorn worker processes

## Maintenance

### Regular Tasks
- Update dependencies monthly
- Rotate JWT secrets quarterly
- Review security logs weekly
- Monitor failed login attempts
- Check database performance
- Update documentation

### Monitoring
- Track API response times
- Monitor error rates
- Watch failed login attempts
- Database connection health
- Token refresh rates

## Support

For detailed information, refer to:
- `README.md`: Full documentation
- `QUICK_START.md`: Quick start guide
- Code comments: Extensive inline documentation
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## License

MIT License - Free to use in your projects!
