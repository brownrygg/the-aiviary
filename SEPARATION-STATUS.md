# Architecture Separation Status

**Goal**: Transform monolithic content-nest into modular Stage 1 architecture (3-layer system)

**Date Started**: 2026-01-06
**Current Status**: Day 3-4 Complete (aiviary-chat-ui Integration) ✅

---

## Architecture Transformation Overview

### Before (Monolith)
```
content-nest/app/
├── analytics-agent       # Hardcoded Meta logic
├── open-webui           # Heavy chat UI
├── sync-worker          # Meta Instagram sync
├── enrichment-worker    # Meta AI enrichment
├── meta-*-mcp/          # 3 MCP servers
├── postgres             # Analytics database
├── n8n                  # Workflows
└── docker-compose.yml   # Everything in one file

= Single deployable unit
= Can't add YouTube without editing analytics-agent
= All services coupled
= OpenWebUI is heavyweight and not designed for aiviary
```

### After (Modular - Stage 1)
```
┌──────────────────────────────────────────────────────┐
│ nest-keeper/ (Layer 1)                               │
│ - Central OAuth for all platforms                    │
│ - Routes credentials to client VMs                   │
└──────────────────────────────────────────────────────┘
                  ↓
┌──────────────────────────────────────────────────────┐
│ aiviary-core/ (Layer 2) ← YOU ARE HERE              │
│                                                      │
│  ┌────────────────┐  ┌─────────────────┐           │
│  │ aiviary-chat-ui│  │ analytics-agent │           │
│  │ (auth, agents, │  │ (AI brain,      │           │
│  │  chats, UI)    │  │  Claude API)    │           │
│  └────────────────┘  └─────────────────┘           │
│         ↕                    ↕                      │
│  ┌──────────────────────────────────────────────┐  │
│  │ AIStreamer: Unified streaming (n8n + OpenAI) │  │
│  └──────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
                  ↕
┌──────────────────────────────────────────────────────┐
│ meta-nest/ (Layer 3)                                 │
│ - sync-worker (Instagram sync)                       │
│ - enrichment-worker (embeddings)                     │
│ - MCP servers (Meta APIs)                            │
│ - postgres (analytics database)                      │
│ - skills/ (meta-sql-skill instructions)              │
└──────────────────────────────────────────────────────┘

= 3 independent deployable units
= Add YouTube = just deploy youtube-nest
= Update meta-nest without touching aiviary-core
= Lightweight custom chat UI designed for aiviary
```

---

## Progress Tracking

### ✅ Day 1-2: Foundation (COMPLETED)

**Objective**: Create directory structure and copy files

**What We Did**:
1. ✅ Created `aiviary-core/app/` directory structure
2. ✅ Copied `analytics-agent/` → `aiviary-core/app/aiviary-chat/`
3. ✅ Copied `nginx/` → `aiviary-core/app/nginx/`
4. ✅ Created initial `docker-compose.yml`
5. ✅ Created `.env.example`
6. ✅ Created `skills/` directory (for future skill registration)
7. ✅ Created comprehensive README.md

---

### ✅ Day 3-4: aiviary-chat-ui Integration (COMPLETED)

**Objective**: Replace OpenWebUI with custom aiviary-chat-ui

**What We Did**:

1. ✅ **Cloned aiviary-chat-ui from GitHub**
   - Source: `brownrygg/aiviary-chat`
   - Destination: `aiviary-core/app/aiviary-chat-ui/`

2. ✅ **Updated streaming.py to create unified AIStreamer**
   - Auto-detects backend type (OpenAI vs n8n)
   - `/v1/chat/completions` → OpenAI streaming (SSE with delta format)
   - n8n webhooks → Concatenated JSON streaming
   - Backwards compatible: `N8nStreamer = AIStreamer`

3. ✅ **Copied analytics-agent to aiviary-core**
   - Source: `content-nest/app/analytics-agent/`
   - Destination: `aiviary-core/app/analytics-agent/`

4. ✅ **Created unified docker-compose.yml**
   - PostgreSQL (for aiviary-chat-ui auth/chats)
   - analytics-agent (AI brain - OpenAI-compatible API)
   - backend (FastAPI auth, agents, chats)
   - frontend (React + Vite chat interface)
   - nginx (reverse proxy with SSE support)

5. ✅ **Updated nginx configuration**
   - `/` → frontend (React app)
   - `/api/*` → backend (FastAPI)
   - `/v1/*` → analytics-agent (OpenAI-compatible)
   - SSE support: `proxy_buffering off`

6. ✅ **Updated .env.example**
   - PostgreSQL configuration
   - JWT authentication
   - Anthropic API key
   - Analytics database connection

7. ✅ **Updated README.md**
   - New architecture documentation
   - How to create agents
   - API endpoints
   - Troubleshooting

**Key Changes**:
- **Removed OpenWebUI** - No longer needed
- **Added aiviary-chat-ui** - Lightweight, purpose-built chat UI
- **Unified streaming** - AIStreamer handles both n8n and OpenAI formats
- **Multi-tenant auth** - JWT cookies, team-based isolation

**Files Created/Modified**:
```
aiviary-core/app/
├── aiviary-chat-ui/              # NEW - cloned from GitHub
│   ├── backend/
│   │   └── streaming.py          # MODIFIED - AIStreamer class
│   └── frontend/
├── analytics-agent/              # COPIED from content-nest
├── nginx/
│   └── nginx.conf.template       # MODIFIED - new routing
├── docker-compose.yml            # REPLACED - new services
├── .env.example                  # REPLACED - new config
└── README.md                     # REPLACED - new documentation
```

---

### 🔲 Day 5-6: Test Integration (NEXT)

**Objective**: Verify aiviary-core starts and works

**Tasks**:
1. Create `.env` file with real values
2. Start services: `docker compose up -d`
3. Create initial user
4. Create analytics agent pointing to `http://analytics-agent:8000/v1/chat/completions`
5. Test chat functionality
6. Verify streaming works

**Commands**:
```bash
cd aiviary-core/app

# Create .env
cp .env.example .env
# Edit .env with real values

# Start services
docker compose up -d

# Check logs
docker compose logs -f

# Create user
docker compose exec backend python create_superuser.py

# Access UI
open http://localhost:8092
```

**Validation**:
- ✅ All containers start without errors
- ✅ User can log in
- ✅ Agent can be created
- ✅ Chat messages stream properly
- ✅ Markdown renders correctly

---

### 🔲 Day 7-10: Tool Registry (PENDING)

**Objective**: Make aiviary-core receive tools dynamically from meta-nest

**Tasks**:
1. Add tool registry API to aiviary-chat-ui backend
2. Create registration script in content-nest
3. Test registration flow

---

### 🔲 Week 2: Skills System (PENDING)

**Objective**: Implement progressive instruction disclosure

---

### 🔲 Week 3: Make meta-nest Independent (PENDING)

**Objective**: meta-nest can deploy/update independently

---

## Current Directory State

```
/home/rikk/services/content-aiviary/
├── STAGE-1-ARCHITECTURE-BLUEPRINT.md  # Full blueprint
├── SEPARATION-STATUS.md               # This file
├── nest-keeper/                       # Layer 1 (existing)
│   └── app/
├── content-nest/                      # Original (will → meta-nest)
│   └── app/
│       ├── analytics-agent/           # Still here (original)
│       ├── sync-worker/
│       ├── enrichment-worker/
│       ├── meta-*-mcp/
│       ├── postgres/
│       └── docker-compose.yml         # Monolith
└── aiviary-core/                      # Layer 2
    ├── README.md                      # Updated
    └── app/
        ├── aiviary-chat-ui/           # NEW - from GitHub
        │   ├── backend/               # FastAPI (auth, agents, chats)
        │   │   └── streaming.py       # AIStreamer (n8n + OpenAI)
        │   └── frontend/              # React + Vite
        ├── analytics-agent/           # Copied from content-nest
        ├── nginx/                     # Updated routing
        ├── docker-compose.yml         # New services
        └── .env.example               # New config
```

---

## What Changed (Day 3-4)

| Component | Before | After |
|-----------|--------|-------|
| Chat UI | OpenWebUI (heavyweight) | aiviary-chat-ui (lightweight) |
| Streaming | N8nStreamer only | AIStreamer (n8n + OpenAI) |
| Auth | OpenWebUI accounts | JWT with httpOnly cookies |
| Agents | OpenWebUI models | Custom agents with webhooks |
| Backend | analytics-agent only | backend + analytics-agent |

---

## What's Not Broken

✅ **Original content-nest still works** - Production system untouched
✅ **All business logic preserved** - Just reorganizing, not rewriting
✅ **Database schema unchanged** - SQL helpers still work
✅ **Sync/enrichment logic unchanged** - Instagram sync still works
✅ **analytics-agent unchanged** - Still works the same way

---

## Technical Details

### AIStreamer Auto-Detection

The `streaming.py` module detects backend type from URL:

```python
def _detect_backend_type(self, url: str) -> str:
    if "/v1/chat/completions" in url_lower:
        return self.BACKEND_OPENAI
    if "analytics-agent" in url_lower:
        return self.BACKEND_OPENAI
    return self.BACKEND_N8N
```

### Agent Configuration

To use analytics-agent as AI backend:
- Webhook URL: `http://analytics-agent:8000/v1/chat/completions`
- AIStreamer auto-detects OpenAI format
- Streams via SSE

To use n8n workflow as backend:
- Webhook URL: `http://n8n:5678/webhook/your-workflow`
- AIStreamer auto-detects n8n format
- Parses concatenated JSON

### Services

| Service | Port | Purpose |
|---------|------|---------|
| postgres | 5432 | Auth/chats database |
| analytics-agent | 8000 | AI brain (Claude) |
| backend | 8000 | FastAPI API |
| frontend | 3000 | React chat UI |
| nginx | 8092/8445 | Reverse proxy |

---

## Next Steps

**Immediate (Day 5-6)**:
1. Create real `.env` file
2. Start services
3. Test login flow
4. Test agent creation
5. Test streaming

**Week 1**:
- Connect to content-nest analytics database
- Test SQL queries via analytics-agent

**Week 2**:
- Tool registry API
- Skills system

---

## Success Criteria

| Milestone | Status | Date |
|-----------|--------|------|
| Day 1-2: Directory structure | ✅ | 2026-01-06 |
| Day 3-4: aiviary-chat-ui integration | ✅ | 2026-01-07 |
| Day 5-6: Test integration | 🔲 | |
| Day 7-10: Tool registry | 🔲 | |
| Week 2: Skills system | 🔲 | |
| Week 3: meta-nest independent | 🔲 | |

---

## Resources

- [aiviary-core/README.md](./aiviary-core/README.md) - Layer 2 documentation
- [STAGE-1-ARCHITECTURE-BLUEPRINT.md](./STAGE-1-ARCHITECTURE-BLUEPRINT.md) - Full architecture design
- [aiviary-chat-ui CLAUDE.md](./aiviary-core/app/aiviary-chat-ui/CLAUDE.md) - Chat UI documentation
- [content-nest/app/docs/](./content-nest/app/docs/) - Current implementation docs

---

**Last Updated**: 2026-01-07 (Day 3-4 Complete - aiviary-chat-ui Integration)
**Next Milestone**: Day 5-6 - Test aiviary-core integration
