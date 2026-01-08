# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Aiviary Connect is an OAuth credential receiver service that stores encrypted OAuth tokens from a central broker. Part of the Aiviary Tree client deployment stack.

**Stack:** Node.js 20 + Express | PostgreSQL with AES-256 encryption

## Commands

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start

# Docker (from parent app/ directory)
docker compose up aiviary-connect -d
docker compose logs -f aiviary-connect
```

## Architecture

### Role in Aiviary Tree

Aiviary Connect receives OAuth credentials from the central Nest Keeper broker and stores them encrypted in the client's PostgreSQL database. MCP servers and workers fetch decrypted tokens from this service - credentials never flow through n8n workflows.

```
Central OAuth Broker (Nest Keeper)
    │ POST /api/credentials
    ▼
Aiviary Connect (this service)
    │ Encrypted storage in nest_meta.oauth_credentials
    ▼
MCP Servers & Workers (internal only)
    GET /api/credentials/token
```

### API Endpoints

| Endpoint | Purpose | Who Uses It |
|----------|---------|-------------|
| `POST /api/credentials` | Receive tokens from broker (X-API-Key auth) | Nest Keeper broker |
| `GET /api/credentials?platform=meta` | Get metadata without token | n8n workflows |
| `GET /api/credentials/token?platform=meta` | Get decrypted token | MCP servers (internal) |
| `GET /api/credentials/status` | Connection status for all platforms | Health checks, UI |
| `GET /health` | Service health check | Docker healthcheck |
| `GET /onboard/success` | OAuth success page shown to users | Browser redirect |

### Supported Platforms

`meta`, `asana`, `google`, `monday`, `slack`, `linkedin`, `tiktok`, `youtube`

### Security Model

- Tokens encrypted with AES-256-CBC before storage
- `/api/credentials/token` only accessible on internal Docker network
- `VM_API_KEY` required for receiving credentials from broker
- `ENCRYPTION_KEY` must remain constant after first use (tokens become unreadable if changed)

### Database

Uses the `nest_meta` database with tables:
- `oauth_credentials` - Encrypted tokens by platform
- `sync_jobs` - Backfill job queue (created on first Meta auth)

## Environment Variables

Required:
```env
VM_API_KEY=         # Auth key for broker → this service
ENCRYPTION_KEY=     # AES-256 hex key (32 bytes = 64 hex chars)
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=nest_meta
POSTGRES_USER=
POSTGRES_PASSWORD=
CLIENT_ID=client    # Single-tenant identifier for storage
PORT=3006
```

## Testing

```bash
# Health check
curl http://localhost:3006/health

# Get connection status
curl http://localhost:3006/api/credentials/status

# Get platform metadata (no token)
curl "http://localhost:3006/api/credentials?platform=meta"

# Get decrypted token (internal use only)
curl "http://localhost:3006/api/credentials/token?platform=meta"
```

## Key Files

- `server.js` - Complete application (single file service)
- `Dockerfile` - Production container build
- `MCP-INTEGRATION.md` - Detailed integration guide for MCP servers
