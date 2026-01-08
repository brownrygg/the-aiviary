# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Aiviary Chat is a multi-tenant chat application with n8n webhook integration for streaming AI agents. Part of the Content Aiviary platform.

**Stack:** React 18 + Vite (frontend) | FastAPI + PostgreSQL (backend)

## Development Commands

### First-Time Setup
```bash
./setup.sh  # Installs deps, creates database, generates .env files
```

### Development Servers
```bash
./start-dev.sh  # Starts both backend and frontend

# Or individually:
cd backend && source venv/bin/activate && python main.py  # Backend on :8000
cd frontend && npm run dev                                  # Frontend on :3000
```

### Docker Deployment
```bash
docker compose up -d
```

### Database Setup
```bash
./setup_database.sh  # Create database and run migrations
```

### Admin Utilities (backend/)
```bash
python create_superuser.py  # Create admin user
python check_users.py       # Verify user accounts
python reset_password.py    # Reset user password
./test_streaming.sh         # Test streaming API endpoints
```

### Frontend Build
```bash
cd frontend
npm run build    # Production build to dist/
npm run preview  # Preview production build
```

## Architecture

### Multi-Tenancy Model
- **Teams** contain users and agents
- All database queries filter by `team_id` for data isolation
- Users belong to exactly one team

### Authentication Flow
- JWT tokens stored in httpOnly cookies (not localStorage)
- Access token + 7-day refresh token with rotation
- bcrypt password hashing (12+ rounds)
- Rate limiting: 5 login attempts/minute/IP

### Streaming Architecture
The chat system supports two AI backends via `backend/streaming.py`:

1. **n8n Webhooks** - Concatenated JSON streaming format
   - Agent `webhook_url` points to n8n webhook node
   - Agent `bearer_token` passed as Authorization header

2. **OpenAI-compatible APIs** - SSE with delta format
   - Auto-detected from URL pattern

Flow: User message → POST to `/api/chats/{id}/messages` → Backend calls agent webhook → SSE stream back to frontend → Message saved to database

### Key Components

**Frontend (`frontend/src/`):**
- `App.jsx` - Router and protected routes
- `components/ChatArea.jsx` - Core chat interface with SSE handling
- `components/ArtifactRenderer.jsx` - Rich output (code, HTML, Mermaid diagrams)
- `api/client.js` - Axios instance with cookie auth and 401 interceptor

**Backend (`backend/`):**
- `main.py` - FastAPI app with CORS, security headers, exception handlers
- `routers/chats.py` - Chat CRUD + streaming message endpoint
- `routers/auth.py` - JWT authentication endpoints
- `routers/agents.py` - Agent management (admin only)
- `streaming.py` - AIStreamer class for n8n/OpenAI backends
- `models.py` - SQLAlchemy async models (Team, User, Agent, Chat)

### Database Schema (PostgreSQL)
- **teams** - Organization containers with JSONB settings
- **users** - Auth with team_id foreign key
- **agents** - AI config with webhook_url and bearer_token
- **chats** - Conversations with JSONB messages array
- **error_logs** - Error tracking per team

## API Endpoints

**Auth:** `/api/auth/{register,login,logout,me,refresh,health}`

**Agents:** `/api/agents` (CRUD) + `/api/agents/{id}/avatar` (upload)

**Chats:** `/api/chats` (CRUD) + `/api/chats/{id}/messages` (streaming SSE)

## Configuration

**Backend (.env):**
```env
DATABASE_URL=postgresql+asyncpg://user:pass@db:5432/app_db
JWT_SECRET_KEY=change_in_production
ENVIRONMENT=development
ALLOWED_ORIGINS=http://localhost:3000
```

**Frontend (.env):**
```env
VITE_API_URL=http://localhost:8000
```

## Styling

- Tailwind CSS with custom glass-morphism design system
- Custom colors defined in `frontend/tailwind.config.js`: atmosphere, brand, neutral
- Fonts: Lora (serif), Inter (sans-serif)
- Key classes: `glass-panel`, `btn-primary`, `btn-secondary`

## Testing

```bash
cd backend
python test_setup.py       # Verify setup
./test_streaming.sh        # Test streaming endpoints
```

## Documentation

Detailed docs in `backend/`:
- `ARCHITECTURE.md` - System design
- `STREAMING_API_GUIDE.md` - n8n webhook integration
- `PROJECT_STRUCTURE.md` - File-by-file documentation
