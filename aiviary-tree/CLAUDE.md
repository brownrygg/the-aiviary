# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Aiviary Tree is a client deployment stack for the Content Aiviary multi-tenant social media intelligence platform. Each Tree deployment serves one agency client with complete data isolation, providing AI-powered analytics for Meta/Instagram platforms.

**Architecture Pattern:** Nest Keeper (central OAuth broker) + Aiviary Tree (per-client deployments)

## Development Commands

### First-Time Setup
```bash
./setup-aiviary.sh  # Interactive setup: generates .env, registers with OAuth broker, starts services
```

### Docker Operations
```bash
cd app
docker compose up -d                    # Start all services
docker compose up --build -d            # Rebuild and start
docker compose down                     # Stop services
docker compose down -v                  # Stop and remove volumes (full reset)
docker compose logs -f <service>        # Follow logs for specific service
docker compose ps                       # List running services
```

### Service-Specific Commands

**Aiviary Chat (React + FastAPI):**
```bash
cd app/ui/aiviary-chat
./setup.sh                              # First-time local setup
./start-dev.sh                          # Start both frontend and backend

# Individual servers
cd backend && source venv/bin/activate && python main.py  # Backend :8000
cd frontend && npm run dev                                 # Frontend :3000
cd frontend && npm run build                               # Production build
```

**Aiviary Connect (Node.js):**
```bash
cd app/ui/aiviary-connect
npm run dev                             # Development with auto-reload
npm start                               # Production
```

**MCP Servers:**
```bash
cd app/nests/meta/mcp/<server-name>
npm run dev                             # Development
npm start                               # Production
```

### Database Access
```bash
docker exec -it postgres psql -U postgres -d aiviary_chat   # Chat database
docker exec -it postgres psql -U postgres -d n8n_db         # n8n database
docker exec -it postgres psql -U postgres -d nest_meta      # Meta analytics database
```

### Admin Utilities
```bash
cd app/ui/aiviary-chat/backend
python create_superuser.py              # Create admin user
python check_users.py                   # Verify user accounts
python reset_password.py                # Reset user password
./test_streaming.sh                     # Test streaming endpoints
```

### Health Checks
```bash
curl http://localhost:8092/health       # Nginx
curl http://localhost:8000/health       # Aiviary Chat backend
curl http://localhost:5678/healthz      # n8n
curl http://localhost:3006/health       # Aiviary Connect
curl http://localhost:3004/health       # Meta Ads MCP
curl http://localhost:3005/health       # Instagram Analytics MCP
curl http://localhost:3007/health       # Meta Ad Library MCP
```

## Architecture

### High-Level Structure
```
aiviary-tree/
└── app/
    ├── ui/
    │   ├── aiviary-chat/          # AI chat interface (React + FastAPI)
    │   └── aiviary-connect/       # OAuth credential receiver (Express)
    ├── services/
    │   ├── analytics-agent/       # Claude-powered AI brain
    │   └── n8n/                   # Workflow automation config
    ├── nests/
    │   └── meta/                  # Meta platform integration
    │       ├── sync-worker/       # Data synchronization
    │       ├── enrichment-worker/ # AI enrichment (embeddings, sentiment)
    │       └── mcp/               # MCP servers for AI tool access
    ├── branches/                  # Future integrations (Slack, Asana, etc.)
    ├── shared/
    │   ├── database/              # Init scripts & migrations
    │   ├── nginx/                 # Reverse proxy config
    │   └── credentials/           # Service account files
    └── docker-compose.yml         # 16-service orchestration
```

### Database Isolation
Each component has its own database:
- `aiviary_chat` - Users, teams, agents, conversations
- `n8n_db` - Workflow engine
- `nest_meta` - Meta platform analytics, OAuth credentials

### Multi-Tenancy Model
- **Teams** are the root isolation unit containing users and agents
- All database queries filter by `team_id`
- Users belong to exactly one team
- JWT tokens stored in httpOnly cookies (not localStorage)

### Credential Flow
```
Central OAuth Broker (Nest Keeper)
    │ POST /api/credentials (X-API-Key auth)
    ▼
Aiviary Connect (AES-256 encrypted storage)
    │ GET /api/credentials/token (internal only)
    ▼
MCP Servers & Workers (use tokens to call Meta APIs)
```
Credentials never flow through n8n workflows.

### MCP Services
Three MCP servers expose Meta APIs to AI agents via HTTP:

| Service | Port | Purpose |
|---------|------|---------|
| `meta-ads-mcp` | 3004 | Ad campaigns & performance |
| `instagram-analytics-mcp` | 3005 | Instagram insights |
| `meta-ad-library-mcp` | 3007 | Competitor ad research |

All expose: `GET /health`, `GET /tools`, `POST /call`, `POST /mcp`

### Streaming Architecture
The chat system supports two AI backend types via `backend/streaming.py`:
1. **n8n Webhooks** - Concatenated JSON streaming
2. **OpenAI-compatible APIs** - SSE with delta format

Flow: User message → Backend calls agent webhook → SSE stream → Save to database

## Key Patterns

### Environment Configuration
- All secrets in `app/.env` (never committed)
- Generated via `setup-aiviary.sh` with `openssl rand`
- Template at `app/.env.example`
- `ENCRYPTION_KEY` must remain constant after first use

### Service Dependencies
Startup order enforced via Docker healthchecks:
1. PostgreSQL (pgvector) → 2. Redis → 3. Migrations → 4. n8n → 5. App services → 6. Workers → 7. MCP servers → 8. Nginx → 9. Cloudflared

### Nginx Configuration
Uses `envsubst` template pattern:
```bash
envsubst < nginx.conf.template > nginx.conf
```

### Error Handling
- `error_logs` table per team for tracking
- Rate limiting: 5 login attempts/minute/IP
- bcrypt password hashing (12+ rounds)

## Service Ports

| Service | Port | Access |
|---------|------|--------|
| Nginx (Chat UI) | 8092 | Public via Cloudflare |
| n8n | 5678 | Internal/Tailscale |
| Aiviary Chat Backend | 8000 | Internal |
| Aiviary Connect | 3006 | Internal + broker callback |
| Meta Ads MCP | 3004 | Internal |
| Instagram Analytics MCP | 3005 | Internal |
| Meta Ad Library MCP | 3007 | Internal |
| PostgreSQL | 5432 | Internal |
| Redis | 6379 | Internal |

## Component Documentation

Each major component has its own CLAUDE.md:
- `app/ui/aiviary-chat/CLAUDE.md` - Chat UI detailed guidance
- `app/ui/aiviary-connect/CLAUDE.md` - OAuth receiver guidance
- `app/docs/MCP-SERVICES-DOCUMENTATION.md` - Full MCP API reference
- `app/docs/N8N-QUICK-START.md` - n8n workflow setup
