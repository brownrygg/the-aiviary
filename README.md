# The Aiviary

**Multi-tenant social media intelligence platform for agencies**

A modular architecture that helps agencies consolidate client analytics data from social media platforms into a structure that an analytics agent can access.

---

## Architecture Overview

```
                    ┌─────────────────────────┐
                    │      Nest Keeper        │
                    │   (Central OAuth)       │
                    │   ONE per agency        │
                    └───────────┬─────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
        ▼                       ▼                       ▼
┌───────────────┐       ┌───────────────┐       ┌───────────────┐
│ Aiviary Tree  │       │ Aiviary Tree  │       │ Aiviary Tree  │
│  (Client A)   │       │  (Client B)   │       │  (Client C)   │
└───────────────┘       └───────────────┘       └───────────────┘
```

### Layer 1: Nest Keeper (One per Agency)

Central OAuth broker that handles authentication for all platforms. Stores agency-level Meta App credentials, Google Project keys, etc.

- **Location**: `nest-keeper/`
- **Deployment**: Single VM, publicly accessible via Cloudflare Tunnel
- **Purpose**: Facilitate OAuth flows for all client Trees

### Layer 2: Aiviary Tree (N per Agency)

Complete client deployment stack with modular components:

```
aiviary-tree/
├── ui/
│   ├── aiviary-chat/          # AI chat interface
│   └── aiviary-connect/       # OAuth onboarding portal
├── services/
│   ├── analytics-agent/       # AI brain (Anthropic Claude)
│   └── n8n/                   # Workflow automation
├── nests/
│   └── meta/                  # Meta platform (Instagram, Ads)
│       ├── sync-worker/
│       ├── enrichment-worker/
│       └── mcp/               # MCP servers
├── branches/                  # Future: Slack, Asana, etc.
├── shared/
│   ├── nginx/
│   ├── database/
│   └── credentials/
└── docker-compose.yml
```

---

## Database Strategy

Each component has its own isolated database:

| Database | Component | Purpose |
|----------|-----------|---------|
| `aiviary_chat` | Chat UI | Users, teams, agents, chats |
| `n8n_db` | n8n | Workflows, credentials |
| `nest_meta` | Meta Nest | Instagram/Ads analytics |
| `nest_youtube` | (Future) | YouTube analytics |
| `branch_slack` | (Future) | Slack integration |

**Benefits:**
- API changes to one platform only affect that database
- Add/remove nests without impacting other services
- Independent backups and migrations

---

## Quick Start

### 1. Deploy Nest Keeper (Once per Agency)

```bash
cd nest-keeper/app
cp .env.example .env
# Configure Meta App credentials
docker compose up -d
```

### 2. Deploy Aiviary Tree (Per Client)

```bash
cd aiviary-tree/app
cp .env.example .env
# Configure client-specific settings
docker compose up -d
```

### 3. Verify Services

```bash
docker compose ps
docker compose logs -f
```

---

## Components

### UI Layer

| Component | Port | Description |
|-----------|------|-------------|
| Aiviary Chat | 8092 | AI chat interface with streaming |
| Aiviary Connect | 3006 | OAuth onboarding portal |

### Services Layer

| Service | Description |
|---------|-------------|
| Analytics Agent | AI brain powered by Claude |
| n8n | Workflow automation engine |

### Nests (Platform Integrations)

| Nest | Status | Platforms |
|------|--------|-----------|
| Meta | Built | Instagram, Ads, Ad Library |
| YouTube | Planned | YouTube Analytics |
| TikTok | Planned | TikTok Analytics |

### Branches (Communication/PM)

| Branch | Status | Service |
|--------|--------|---------|
| Slack | Planned | Messaging |
| Asana | Planned | Project management |
| Google Drive | Planned | File storage |

---

## Modularity

### Adding a New Nest

1. Create `nests/{platform}/` directory structure
2. Add database to `shared/database/init.sh`
3. Add services to `docker-compose.yml`
4. Connect MCP server to analytics agent

### Removing a Nest

1. Remove services from `docker-compose.yml`
2. Remove nest directory
3. Optionally drop database

Other services (Chat, n8n) continue working unaffected.

---

## Documentation

| Document | Location |
|----------|----------|
| Nest Keeper Setup | `nest-keeper/README.md` |
| Aiviary Tree Setup | `aiviary-tree/README.md` |
| Meta Nest | `aiviary-tree/app/nests/meta/README.md` |
| n8n Configuration | `aiviary-tree/app/services/n8n/README.md` |
| Branches Guide | `aiviary-tree/app/branches/README.md` |

---

## Technology Stack

- **Databases**: PostgreSQL 16 with pgvector
- **Workflow**: n8n
- **AI**: Anthropic Claude, Google Vertex AI
- **Frontend**: React + Vite
- **Backend**: FastAPI (Python), Express (Node.js)
- **Infrastructure**: Docker, Cloudflare Tunnels, Tailscale
