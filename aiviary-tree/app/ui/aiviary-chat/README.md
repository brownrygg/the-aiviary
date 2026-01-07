# Agent Chat UI

A lightweight, multi-tenant chat application with n8n webhook integration for streaming AI agents.

## Features

- 🔐 JWT authentication with httpOnly cookies
- 👥 Multi-tenant architecture with team-based isolation
- 🤖 Multiple AI agents via n8n webhooks
- 💬 Real-time streaming with Server-Sent Events (SSE)
- 📊 Conversation history with JSONB storage
- 🎨 Modern React UI with Tailwind CSS
- 🔒 Role-based access control (user/admin)
- 🖼️ Avatar support for agents

## Quick Start

### 1. Run Setup (First Time Only)

```bash
./setup.sh
```

This script will:
- Install Python backend dependencies (in a virtual environment)
- Install Node.js frontend dependencies
- Set up the PostgreSQL database
- Create environment configuration files

### 2. Configure Environment

Edit `backend/.env` with your database credentials:

```env
DATABASE_URL=postgresql://user:password@localhost/agent_chat_db
SECRET_KEY=your-secret-key-here
```

### 3. Start Development Servers

```bash
./start-dev.sh
```

This will start both the backend and frontend in development mode.

Or start them separately:

**Backend:**
```bash
cd backend
source venv/bin/activate
python main.py
# or: ./run.sh
```

**Frontend:**
```bash
cd frontend
npm run dev
```

### 4. Access the Application

- **Frontend:** http://localhost:3000
- **Backend API:** http://localhost:8000
- **API Documentation:** http://localhost:8000/docs

## Project Structure

```
agent-chat-ui/
├── backend/              # FastAPI backend
│   ├── main.py          # App entry point
│   ├── models.py        # SQLAlchemy models
│   ├── schemas.py       # Pydantic schemas
│   ├── auth.py          # JWT utilities
│   ├── streaming.py     # N8n webhook integration
│   └── routers/         # API endpoints
│       ├── auth.py      # Authentication
│       ├── agents.py    # Agent management
│       └── chats.py     # Chat & streaming
├── frontend/            # React frontend
│   ├── src/
│   │   ├── components/  # React components
│   │   └── api/         # API client
│   └── package.json
├── schema.sql           # Database schema
├── setup.sh             # Complete setup script
└── start-dev.sh         # Start dev servers
```

## Architecture

### Backend (FastAPI)
- **Authentication:** JWT tokens in httpOnly cookies
- **Database:** PostgreSQL with UUID primary keys
- **Streaming:** Server-Sent Events (SSE) for real-time AI responses
- **n8n Integration:** N8nStreamer class for webhook communication
- **Multi-tenancy:** Team-based data isolation

### Frontend (React)
- **Framework:** React 18 with Vite
- **Styling:** Tailwind CSS
- **Routing:** React Router
- **API Client:** Axios with cookie support
- **Responsive:** Mobile, tablet, and desktop layouts

### Database Schema
- **teams** - Organization/team management
- **users** - User accounts with team association
- **agents** - AI agent configurations
- **chats** - Conversation storage (JSONB messages)
- **error_logs** - Error tracking

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current user

### Agents
- `GET /api/agents` - List agents
- `POST /api/agents` - Create agent (admin only)
- `PUT /api/agents/{id}` - Update agent (admin only)
- `POST /api/agents/{id}/avatar` - Upload avatar (admin only)

### Chats
- `GET /api/chats` - List chats
- `POST /api/chats` - Create chat
- `POST /api/chats/{id}/messages` - Send message (SSE streaming)

## Development Scripts

- `./setup.sh` - Complete setup (dependencies + database)
- `./start-dev.sh` - Start both servers in development mode
- `backend/test_streaming.sh` - Test the streaming API
- `backend/create_superuser.py` - Create admin user

## Testing

Test the streaming API:

```bash
cd backend
./test_streaming.sh
```

## Production Deployment

See `backend/README.md` for production deployment instructions including:
- Environment configuration
- Database migrations
- HTTPS/SSL setup
- Docker deployment
- Rate limiting configuration

## Documentation

- `backend/STREAMING_API_GUIDE.md` - Complete API documentation
- `backend/ARCHITECTURE.md` - Architecture decisions
- `backend/PROJECT_STRUCTURE.md` - Detailed project structure

## Security Features

- httpOnly cookies (XSS protection)
- SameSite=Strict (CSRF protection)
- JWT token authentication
- Password hashing with bcrypt
- Team-based data isolation
- Role-based access control
- Input validation with Pydantic

## Requirements

- Python 3.8+
- Node.js 18+
- PostgreSQL 12+
- npm or yarn

## License

MIT

## Support

For issues and questions, see the documentation in the `backend/` directory.
