# Aiviary Tree

Client deployment template for the Aiviary platform. Each Tree deployment serves one agency client with complete data isolation.

## Structure

```
aiviary-tree/
└── app/
    ├── ui/
    │   ├── aiviary-chat/          # AI chat interface
    │   └── aiviary-connect/       # OAuth onboarding portal
    ├── services/
    │   ├── analytics-agent/       # AI brain (Claude)
    │   └── n8n/                   # Workflow configuration
    ├── nests/
    │   └── meta/                  # Meta platform (Instagram, Ads)
    ├── branches/                  # Future: Slack, Asana, etc.
    ├── shared/
    │   ├── nginx/                 # Reverse proxy
    │   ├── database/              # Init scripts & migrations
    │   └── credentials/           # API credentials
    └── docker-compose.yml
```

## Quick Start

```bash
cd app
cp .env.example .env
# Edit .env with client-specific settings
docker compose up -d
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| Aiviary Chat | 8092 | AI chat interface |
| Aiviary Connect | 3006 | OAuth onboarding |
| n8n | 5678 | Workflow automation |
| Analytics Agent | 8000 | AI backend (internal) |

## Databases

Each component has its own isolated database:
- `aiviary_chat` - Chat UI (users, teams, agents)
- `n8n_db` - Workflow engine
- `nest_meta` - Meta platform analytics

## Documentation

- [Meta Nest](app/nests/meta/README.md) - Instagram/Ads integration
- [Branches](app/branches/README.md) - Future integrations
- [n8n Configuration](app/services/n8n/README.md) - Workflow docs
- [MCP Services](app/docs/MCP-SERVICES-DOCUMENTATION.md) - API reference
