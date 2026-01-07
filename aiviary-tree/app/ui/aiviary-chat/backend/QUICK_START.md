# Quick Start Guide

Get your FastAPI authentication system up and running in 5 minutes!

## 1. One-Command Setup (Linux/macOS)

```bash
./run.sh
```

This script will:
- Create `.env` if it doesn't exist
- Set up virtual environment
- Install dependencies
- Verify setup
- Start the server

## 2. Manual Setup (All Platforms)

### Step 1: Install Dependencies
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### Step 2: Configure Environment
```bash
cp .env.example .env
```

Edit `.env` and set:
```env
# Generate with: openssl rand -hex 32
JWT_SECRET_KEY=your-secret-key-here

# Your PostgreSQL database
DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/app_db

# Your frontend URL (for CORS)
ALLOWED_ORIGINS=http://localhost:3000
```

### Step 3: Set Up Database

Using Docker (easiest):
```bash
docker run -d \
  --name postgres-auth \
  -e POSTGRES_DB=app_db \
  -e POSTGRES_USER=app_user \
  -e POSTGRES_PASSWORD=your-password \
  -p 5432:5432 \
  postgres:16
```

Or install PostgreSQL locally and create database.

### Step 4: Verify Setup
```bash
python test_setup.py
```

### Step 5: Create Admin User
```bash
python create_superuser.py
```

### Step 6: Start Server
```bash
uvicorn main:app --reload
```

## 3. Test the API

### Using the Docs (Easiest)
Visit: http://localhost:8000/docs

### Using curl
```bash
# Register
curl -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123",
    "full_name": "John Doe"
  }'

# Login
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123"
  }'

# Get current user
curl -X GET http://localhost:8000/api/auth/me -b cookies.txt
```

## 4. Frontend Integration

```javascript
// Login
const response = await fetch('http://localhost:8000/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',  // IMPORTANT!
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'SecurePass123'
  })
});

// Get user info
const userResponse = await fetch('http://localhost:8000/api/auth/me', {
  credentials: 'include'  // IMPORTANT!
});
const user = await userResponse.json();
```

**Key point**: Always use `credentials: 'include'` to send cookies!

## 5. Common Issues

### "Not authenticated" errors
- Add `credentials: 'include'` to all fetch requests
- Check CORS: Add your frontend URL to `ALLOWED_ORIGINS` in `.env`

### Database connection errors
- Ensure PostgreSQL is running
- Check `DATABASE_URL` format in `.env`
- Verify database exists

### CORS errors
- Add frontend URL to `ALLOWED_ORIGINS` in `.env`
- Ensure `allow_credentials=True` in CORS middleware (already set)

## 6. Useful Commands

```bash
# Start server with auto-reload
uvicorn main:app --reload

# Create admin user
python create_superuser.py

# Verify setup
python test_setup.py

# Run with Gunicorn (production)
gunicorn main:app -w 4 -k uvicorn.workers.UvicornWorker
```

## 7. API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | Get current user |
| POST | `/api/auth/refresh` | Refresh token |

## 8. Security Features

- JWT tokens in httpOnly cookies (XSS protection)
- bcrypt password hashing (12 rounds)
- Rate limiting on login (5/minute)
- HTTPS enforcement in production
- SameSite=Strict cookies (CSRF protection)
- Password complexity requirements
- Generic error messages (prevents enumeration)

## 9. Next Steps

1. Customize user model in `models.py`
2. Add more fields to registration in `schemas.py`
3. Create protected routes using dependencies
4. Add email verification
5. Implement password reset
6. Add OAuth providers (Google, GitHub, etc.)

## 10. Getting Help

- Read the full [README.md](README.md)
- Check API docs: http://localhost:8000/docs
- Review code comments (extensively documented)
- FastAPI docs: https://fastapi.tiangolo.com/

## Production Deployment

1. Set `ENVIRONMENT=production` in `.env`
2. Use strong `JWT_SECRET_KEY` (32+ random bytes)
3. Enable HTTPS
4. Use proper database (not SQLite)
5. Set up monitoring and logging
6. Use gunicorn/uvicorn workers
7. Deploy behind reverse proxy (nginx)

Happy coding!
