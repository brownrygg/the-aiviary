# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Nest Keeper** is the central OAuth broker component of The Aiviary platform. It handles multi-platform OAuth authentication and forwards credentials to registered client VMs (Aiviary Tree instances).

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         NEST KEEPER                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────────┐ │
│  │ oauth-broker│→ │oauth-postgres│  │  client_vm_registry table   │ │
│  │   :3000     │  │oauth-redis   │  │  Maps client_id → VM URL    │ │
│  └──────┬──────┘  └─────────────┘  └─────────────────────────────┘ │
└─────────┼───────────────────────────────────────────────────────────┘
          │ POST /api/credentials (with VM_API_KEY)
          ▼
      Client VMs (Aiviary Tree instances)
```

## Development Commands

```bash
# Start all services (includes cloudflared tunnel)
./start.sh

# Or use docker compose directly
docker compose up -d

# View logs
docker compose logs -f oauth-broker

# Health check
curl http://localhost:3000/health

# Development mode (with file watching)
cd oauth-broker && npm run dev
```

## Database Access

```bash
# Connect to PostgreSQL
docker exec -it oauth-broker-postgres psql -U oauth_user -d oauth_broker

# Useful queries
SELECT * FROM client_vm_registry;              # List registered clients
SELECT * FROM oauth_events ORDER BY created_at DESC LIMIT 10;  # Recent events
```

## Client VM Management

```bash
# Register new client
curl -X POST http://localhost:3000/admin/clients \
  -H "Content-Type: application/json" \
  -d '{"client_id": "client-a", "client_name": "Client A", "vm_url": "https://client-a.example.com", "vm_api_key": "secret"}'

# List clients
curl http://localhost:3000/admin/clients

# View OAuth events
curl http://localhost:3000/admin/events?client_id=client-a&limit=50
```

## OAuth Flow

1. Client initiates: `GET /auth/:platform?client_id=xxx`
2. User authenticates with platform (Meta, Google, etc.)
3. Platform redirects to: `GET /callback?code=xxx&state=xxx`
4. Broker exchanges code for tokens, forwards to client VM: `POST {vm_url}/api/credentials`
5. User redirected to client VM success page

## Supported Platforms

Platform handlers in `oauth-broker/platforms/`:
- `meta.js` - Instagram/Facebook (primary)
- `asana.js`, `google.js`, `monday.js`, `slack.js`, `linkedin.js`, `tiktok.js`, `youtube.js`

Each handler implements:
- `getAuthUrl(clientId, state, config)` - Build OAuth authorization URL
- `handleCallback(code, config)` - Exchange code for tokens, return standardized payload

## Key Files

| File | Purpose |
|------|---------|
| `oauth-broker/server.js` | Express server, routes, encryption |
| `oauth-broker/platforms/index.js` | Platform registry and validation |
| `oauth-broker/platforms/*.js` | Individual OAuth handlers |
| `database/init.sql` | Database schema |
| `.env.example` | Environment template |

## Adding a New Platform

1. Create `oauth-broker/platforms/newplatform.js`:
```javascript
export default {
  name: 'newplatform',
  getAuthUrl(clientId, state, config) { /* return OAuth URL */ },
  async handleCallback(code, config) { /* return { platform, access_token, ... } */ }
};
```

2. Register in `oauth-broker/platforms/index.js`
3. Add credentials to `.env` and `.env.example`
4. Add config to `platformConfig` in `server.js`

## Environment Variables

Required for operation:
- `META_APP_ID`, `META_APP_SECRET` - Meta/Facebook app credentials
- `ENCRYPTION_KEY` - 32-byte hex for state encryption (never change after first use)
- `OAUTH_REDIRECT_URI` - Public callback URL
- `BASE_URL` - Public base URL
- `POSTGRES_*` - Database connection
- `CLOUDFLARE_TUNNEL_TOKEN` - For public access via Cloudflare

## Security Notes

- State parameter encrypted with AES-256-CBC
- `ENCRYPTION_KEY` must remain constant (tokens become unreadable if changed)
- VM API keys should be unique per client
- Admin endpoints (`/admin/*`) have no authentication - secure via network
