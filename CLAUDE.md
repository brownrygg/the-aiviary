# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**The Aiviary** is a multi-tenant social media intelligence platform with a hub-and-spoke architecture. It enables agency clients to connect Meta/Instagram accounts via OAuth and receive AI-powered analytics through MCP (Model Context Protocol) servers.

**Two main components:**
- **Nest Keeper** (`nest-keeper/`) - Central OAuth broker that handles multi-platform authentication
- **Aiviary Tree** (`aiviary-tree/`) - Per-client deployment stack with analytics, chat UI, and MCP servers

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         NEST KEEPER                                  │
│                    (Central OAuth Broker)                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────────┐ │
│  │ oauth-broker│→ │  postgres   │  │  client_vm_registry table   │ │
│  │   :3000     │  │   (db)      │  │  Maps client_id → VM URL    │ │
│  └──────┬──────┘  └─────────────┘  └─────────────────────────────┘ │
└─────────┼───────────────────────────────────────────────────────────┘
          │ POST /api/credentials (with VM_API_KEY)
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       AIVIARY TREE (Per-Client)                      │
│  ┌──────────────┐   ┌────────────────┐   ┌─────────────────────┐   │
│  │aiviary-connect│→ │   postgres     │   │  MCP Servers        │   │
│  │    :3006     │   │ (nest_meta db) │   │  :3004 meta-ads     │   │
│  └──────────────┘   │ (aiviary_chat) │   │  :3005 instagram    │   │
│         │           │ (n8n_db)       │   │  :3007 ad-library   │   │
│  encrypted tokens   └────────────────┘   └─────────────────────┘   │
│         ▼                                         │                 │
│  ┌──────────────┐   ┌────────────────┐           ▼                 │
│  │ sync-worker  │   │aiviary-chat    │   ┌─────────────────────┐   │
│  │enrichment-wkr│   │ backend :8000  │←─→│       n8n           │   │
│  └──────────────┘   │ frontend :8092 │   │      :5678          │   │
│                     └────────────────┘   └─────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## Development Commands

### Nest Keeper (Central Broker)

```bash
cd nest-keeper/app

# First-time setup
cp .env.example .env
# Edit .env with Meta App credentials

# Start services
docker compose up -d

# View logs
docker compose logs -f oauth-broker

# Register a client VM
curl -X POST http://localhost:3000/admin/clients \
  -H "Content-Type: application/json" \
  -d '{"client_id": "client-a", "vm_url": "https://client-a.example.com", "vm_api_key": "secret"}'
```

### Aiviary Tree (Client Stack)

```bash
cd aiviary-tree

# First-time interactive setup (generates .env, registers with broker)
./setup-aiviary.sh

# Or manual setup
cd app
cp .env.example .env
docker compose up -d

# Rebuild specific service
docker compose build <service> && docker compose up -d <service>
```

### Aiviary Chat (React + FastAPI)

```bash
cd aiviary-tree/app/ui/aiviary-chat

# Local development
./setup.sh                    # First-time: creates venv, installs deps
./start-dev.sh                # Starts both servers

# Individual servers
cd backend && source venv/bin/activate && python main.py  # :8000
cd frontend && npm run dev                                  # :3000

# Admin utilities
cd backend
python create_superuser.py    # Create admin user
python check_users.py         # List users
python reset_password.py      # Reset password
```

### Database Access

```bash
# Aiviary Tree databases
docker exec -it postgres psql -U postgres -d nest_meta      # Meta analytics & credentials
docker exec -it postgres psql -U postgres -d aiviary_chat   # Chat users & conversations
docker exec -it postgres psql -U postgres -d n8n_db         # Workflow engine

# Nest Keeper database
docker exec -it oauth-broker-postgres psql -U oauth_user -d oauth_broker
```

### Health Checks

```bash
# Nest Keeper
curl http://localhost:3000/health

# Aiviary Tree services
curl http://localhost:8092/health     # Nginx
curl http://localhost:8000/health     # Chat backend
curl http://localhost:5678/healthz    # n8n
curl http://localhost:3006/health     # Aiviary Connect
curl http://localhost:3004/health     # Meta Ads MCP
curl http://localhost:3005/health     # Instagram Analytics MCP
curl http://localhost:3007/health     # Meta Ad Library MCP
```

## Key Patterns

### Multi-Platform OAuth
Nest Keeper supports: `meta`, `asana`, `google`, `monday`, `slack`, `linkedin`, `tiktok`, `youtube`. Each platform has its handler in `nest-keeper/app/oauth-broker/platforms/`.

### Credential Security
- Tokens encrypted with AES-256-CBC using `ENCRYPTION_KEY`
- `ENCRYPTION_KEY` **must never change** after first use (tokens become unreadable)
- Credentials flow: Broker → Aiviary Connect → MCP Servers (never through n8n)

### MCP Server Integration
MCP servers expose Meta APIs via HTTP for AI agents. Common endpoints:
- `GET /tools` - List available tools
- `POST /call` - Call a tool: `{"tool": "get_media", "arguments": {"limit": 10}}`
- `POST /mcp` - Full JSON-RPC endpoint

### Database Isolation
Three databases per client stack:
- `nest_meta` - OAuth credentials + analytics data (pgvector)
- `aiviary_chat` - Users, teams, agents, chats
- `n8n_db` - Workflow definitions and execution history

### Streaming AI Chat
`aiviary-tree/app/ui/aiviary-chat/backend/streaming.py` handles two formats:
1. **n8n webhooks** - Concatenated JSON chunks
2. **OpenAI-compatible** - SSE with delta format

## Service Ports

| Service | Port | Network |
|---------|------|---------|
| Nest Keeper OAuth Broker | 3000 | Public (Cloudflare) |
| Aiviary Chat (Nginx) | 8092 | Public |
| n8n | 5678 | Internal/Tailscale |
| Chat Backend | 8000 | Internal |
| Aiviary Connect | 3006 | Internal + broker callback |
| Meta Ads MCP | 3004 | Internal |
| Instagram Analytics MCP | 3005 | Internal |
| Meta Ad Library MCP | 3007 | Internal |

## Component Documentation

Each major component has detailed CLAUDE.md files:
- `aiviary-tree/CLAUDE.md` - Full client stack guide
- `aiviary-tree/app/ui/aiviary-chat/CLAUDE.md` - Chat UI specifics
- `aiviary-tree/app/ui/aiviary-connect/CLAUDE.md` - OAuth receiver
- `aiviary-tree/app/docs/MCP-SERVICES-DOCUMENTATION.md` - Full MCP API reference
- `nest-keeper/app/DEPLOYMENT.md` - Broker deployment guide
