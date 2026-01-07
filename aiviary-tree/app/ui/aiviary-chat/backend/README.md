# FastAPI JWT Authentication System

Production-ready JWT authentication system for FastAPI with httpOnly cookies, bcrypt password hashing, and comprehensive security features.

## Features

### Security
- **JWT Authentication**: Tokens stored in httpOnly cookies (not localStorage)
- **Password Hashing**: bcrypt with 12 rounds minimum (OWASP compliant)
- **Rate Limiting**: 5 login attempts per minute per IP
- **HTTPS Enforcement**: Secure cookies in production
- **CSRF Protection**: SameSite=Strict cookie policy
- **XSS Protection**: httpOnly cookies prevent JavaScript access
- **Generic Error Messages**: Prevents account enumeration attacks
- **Token Refresh**: 7-day refresh tokens with rotation support
- **Password Requirements**: Minimum 8 characters, uppercase, lowercase, and numbers

### Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/auth/register` | Create new user account | No |
| POST | `/api/auth/login` | Authenticate and receive JWT cookie | No |
| POST | `/api/auth/logout` | Clear JWT cookies | No |
| GET | `/api/auth/me` | Get current user info | Yes |
| POST | `/api/auth/refresh` | Refresh access token | Yes (refresh token) |
| GET | `/api/auth/health` | Health check | No |
| GET | `/health` | Application health check | No |

## Installation

### 1. Clone or create project directory
```bash
cd backend/
```

### 2. Create virtual environment
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

### 3. Install dependencies
```bash
pip install -r requirements.txt
```

### 4. Configure environment
```bash
cp .env.example .env
```

Edit `.env` and update these critical values:
```env
# Generate secure secret key:
# openssl rand -hex 32
JWT_SECRET_KEY=your-generated-secret-key

# Database connection
DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/app_db

# Environment
ENVIRONMENT=development  # Use 'production' in production

# CORS origins (your frontend URLs)
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

### 5. Set up database

#### PostgreSQL (Recommended)
```bash
# Install PostgreSQL
sudo apt install postgresql postgresql-contrib  # Ubuntu/Debian
brew install postgresql  # macOS

# Create database
sudo -u postgres psql
CREATE DATABASE app_db;
CREATE USER app_user WITH PASSWORD 'your-password';
GRANT ALL PRIVILEGES ON DATABASE app_db TO app_user;
\q
```

#### Docker PostgreSQL (Alternative)
```bash
docker run -d \
  --name postgres-auth \
  -e POSTGRES_DB=app_db \
  -e POSTGRES_USER=app_user \
  -e POSTGRES_PASSWORD=your-password \
  -p 5432:5432 \
  postgres:16
```

### 6. Run the application

#### Development (with auto-reload)
```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

#### Production (with Gunicorn)
```bash
gunicorn main:app -w 4 -k uvicorn.workers.UvicornWorker -b 0.0.0.0:8000
```

## Usage Examples

### Register New User
```bash
curl -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123",
    "full_name": "John Doe"
  }'
```

**Response:**
```json
{
  "id": 1,
  "email": "user@example.com",
  "full_name": "John Doe",
  "is_active": true,
  "is_superuser": false,
  "created_at": "2025-12-30T00:00:00",
  "last_login": null
}
```

### Login
```bash
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123"
  }'
```

**Response:**
```json
{
  "message": "Login successful"
}
```

Cookies are set in the response:
- `access_token`: Valid for 1 hour
- `refresh_token`: Valid for 7 days

### Get Current User Info
```bash
curl -X GET http://localhost:8000/api/auth/me \
  -b cookies.txt
```

**Response:**
```json
{
  "id": 1,
  "email": "user@example.com",
  "full_name": "John Doe",
  "is_active": true,
  "is_superuser": false,
  "created_at": "2025-12-30T00:00:00",
  "last_login": "2025-12-30T00:05:00"
}
```

### Refresh Token
```bash
curl -X POST http://localhost:8000/api/auth/refresh \
  -b cookies.txt \
  -c cookies.txt
```

**Response:**
```json
{
  "message": "Token refreshed successfully"
}
```

### Logout
```bash
curl -X POST http://localhost:8000/api/auth/logout \
  -b cookies.txt
```

**Response:**
```json
{
  "message": "Successfully logged out"
}
```

## Frontend Integration

### JavaScript/TypeScript Example
```typescript
// Register
async function register(email: string, password: string, fullName: string) {
  const response = await fetch('http://localhost:8000/api/auth/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      full_name: fullName,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail);
  }

  return await response.json();
}

// Login
async function login(email: string, password: string) {
  const response = await fetch('http://localhost:8000/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',  // IMPORTANT: Include cookies
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail);
  }

  return await response.json();
}

// Get current user
async function getCurrentUser() {
  const response = await fetch('http://localhost:8000/api/auth/me', {
    method: 'GET',
    credentials: 'include',  // IMPORTANT: Include cookies
  });

  if (!response.ok) {
    throw new Error('Not authenticated');
  }

  return await response.json();
}

// Logout
async function logout() {
  const response = await fetch('http://localhost:8000/api/auth/logout', {
    method: 'POST',
    credentials: 'include',  // IMPORTANT: Include cookies
  });

  return await response.json();
}
```

### React Hook Example
```typescript
import { useState, useEffect } from 'react';

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    try {
      const response = await fetch('http://localhost:8000/api/auth/me', {
        credentials: 'include',
      });

      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
      }
    } catch (error) {
      console.error('Auth check failed:', error);
    } finally {
      setLoading(false);
    }
  }

  async function login(email: string, password: string) {
    const response = await fetch('http://localhost:8000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });

    if (response.ok) {
      await checkAuth();
    } else {
      const error = await response.json();
      throw new Error(error.detail);
    }
  }

  async function logout() {
    await fetch('http://localhost:8000/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
    setUser(null);
  }

  return { user, loading, login, logout };
}
```

## File Structure

```
backend/
├── main.py                  # FastAPI app entry point
├── database.py             # Database configuration and session management
├── models.py               # SQLAlchemy User model
├── schemas.py              # Pydantic validation models
├── auth.py                 # JWT utilities and password hashing
├── routers/
│   ├── __init__.py
│   └── auth.py             # Authentication endpoints
├── requirements.txt        # Python dependencies
├── .env.example           # Environment configuration template
├── .gitignore             # Git ignore file
└── README.md              # This file
```

## Security Best Practices

### Development vs Production

#### Development
```env
ENVIRONMENT=development
SECURE_COOKIES=false  # Allow HTTP for local testing
DATABASE_URL=postgresql+asyncpg://localhost:5432/dev_db
```

#### Production
```env
ENVIRONMENT=production
SECURE_COOKIES=true  # Require HTTPS
DATABASE_URL=postgresql+asyncpg://prod-db:5432/prod_db
JWT_SECRET_KEY=<generated-with-openssl-rand-hex-32>
```

### Important Security Notes

1. **Never commit `.env` file** - Contains secrets
2. **Use HTTPS in production** - Required for secure cookies
3. **Rotate JWT secrets regularly** - Generate new keys periodically
4. **Use strong database passwords** - Minimum 16 characters
5. **Enable database SSL** - In production environments
6. **Set up monitoring** - Track failed login attempts
7. **Implement token blacklist** - For logout/revocation (optional)
8. **Use rate limiting** - Already implemented for login
9. **Regular security updates** - Keep dependencies updated
10. **Never log passwords or tokens** - Already handled in code

## Database Migrations (Optional)

For production, use Alembic for database migrations:

```bash
# Initialize Alembic
alembic init alembic

# Create migration
alembic revision --autogenerate -m "Initial migration"

# Apply migration
alembic upgrade head
```

## Testing

Create `test_auth.py`:

```python
import pytest
from httpx import AsyncClient
from main import app

@pytest.mark.asyncio
async def test_register():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        response = await ac.post("/api/auth/register", json={
            "email": "test@example.com",
            "password": "Test1234",
            "full_name": "Test User"
        })
    assert response.status_code == 201

@pytest.mark.asyncio
async def test_login():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        response = await ac.post("/api/auth/login", json={
            "email": "test@example.com",
            "password": "Test1234"
        })
    assert response.status_code == 200
    assert "access_token" in response.cookies
```

Run tests:
```bash
pip install pytest pytest-asyncio httpx
pytest test_auth.py
```

## Troubleshooting

### Common Issues

1. **"Not authenticated" on `/api/auth/me`**
   - Ensure `credentials: 'include'` in fetch requests
   - Check CORS configuration includes your frontend URL
   - Verify cookies are not blocked by browser

2. **Database connection errors**
   - Verify PostgreSQL is running
   - Check DATABASE_URL format
   - Ensure database exists and user has permissions

3. **CORS errors**
   - Add frontend URL to ALLOWED_ORIGINS in .env
   - Ensure `allow_credentials=True` in CORS middleware

4. **Secure cookie warnings in development**
   - Set `ENVIRONMENT=development` in .env
   - Or use HTTPS in development (localhost SSL)

## Production Deployment

### Using Docker

Create `Dockerfile`:
```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["gunicorn", "main:app", "-w", "4", "-k", "uvicorn.workers.UvicornWorker", "-b", "0.0.0.0:8000"]
```

Build and run:
```bash
docker build -t fastapi-auth .
docker run -p 8000:8000 --env-file .env fastapi-auth
```

### Environment Variables in Production

Use secrets management:
- AWS Secrets Manager
- HashiCorp Vault
- Kubernetes Secrets
- Docker Secrets

### Reverse Proxy (nginx)

```nginx
server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## API Documentation

Once running, visit:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## License

MIT License - Feel free to use in your projects!

## Support

For issues or questions, please check:
1. This README
2. Code comments (extensively documented)
3. FastAPI documentation: https://fastapi.tiangolo.com/
4. SQLAlchemy documentation: https://docs.sqlalchemy.org/
