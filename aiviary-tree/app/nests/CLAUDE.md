# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

The `nests/` directory contains modular platform integrations for the Aiviary Tree. Each "nest" is a self-contained integration for a specific platform (Meta, Slack, Asana, etc.) with its own workers, MCP servers, and data isolation.

Currently implemented: **Meta Nest** (Instagram Analytics, Meta Ads, Ad Library)

## Directory Structure

```
nests/
└── meta/
    ├── sync-worker/           # Node.js - Fetches data from Meta APIs
    ├── enrichment-worker/     # Python - AI embeddings & transcription
    └── mcp/                   # MCP servers for AI agent access
        ├── meta-ads-mcp/
        ├── instagram-analytics-mcp/
        └── meta-ad-library-mcp/
```

## Development Commands

### Sync Worker (Node.js)
```bash
cd nests/meta/sync-worker
npm install                    # Install dependencies
npm start                      # Production
npm run dev                    # Development mode
```

### Enrichment Worker (Python)
```bash
cd nests/meta/enrichment-worker
pip install -r requirements.txt
python -u main.py              # Start worker (unbuffered output)
```

### MCP Servers (Node.js)
```bash
cd nests/meta/mcp/<server-name>
npm install
npm start                      # Runs http-wrapper.js (Docker mode)
npm run dev                    # Development
node server.js                 # Stdio mode (for testing)
```

### Testing MCP Endpoints
```bash
# Health check
curl http://localhost:3004/health   # meta-ads-mcp
curl http://localhost:3005/health   # instagram-analytics-mcp
curl http://localhost:3007/health   # meta-ad-library-mcp

# List available tools
curl http://localhost:3005/tools

# Call a tool
curl -X POST http://localhost:3005/call \
  -H "Content-Type: application/json" \
  -d '{"tool": "get_profile", "arguments": {}}'
```

## Architecture

### Data Flow
```
Meta APIs (Graph API v21.0)
    ↓
sync-worker (fetches raw data every 24h)
    ↓
PostgreSQL (nest_meta database)
    ↓
enrichment-worker (adds embeddings/transcripts)
    ↓
MCP servers (expose data to AI agents)
```

### Job Queue Pattern (sync-worker)
- Jobs polled every 60 seconds via `FOR UPDATE SKIP LOCKED`
- Retry with exponential backoff: 5m, 10m, 20m (max 3 attempts)
- Daily sync at 4:00 AM, weekly cleanup Sunday 2:00 AM
- Graceful shutdown with 30s timeout for in-flight jobs

### Enrichment Pipeline (enrichment-worker)
- Polls `enrichment_jobs` table every 30 seconds
- Generates multimodal embeddings via Vertex AI (`multimodalembedding@001`, 1408 dimensions)
- Video transcription via Google Cloud Speech-to-Text
- Long videos (>60s) chunked into 50-second segments

### MCP Server Pattern
Each MCP server has two entry points:
- `server.js` - Pure MCP over stdio (JSON-RPC 2.0)
- `http-wrapper.js` - HTTP wrapper for Docker deployment

HTTP endpoints: `GET /health`, `GET /tools`, `POST /call`, `POST /mcp`

Credentials flow: MCP server → `GET aiviary-connect:3006/api/credentials/token` → Meta API

## Key Files

### sync-worker
| File | Purpose |
|------|---------|
| `server.js` | Main entry, cron scheduling, job loop |
| `lib/jobQueue.js` | Job locking, retry logic, statistics |
| `lib/db.js` | PostgreSQL pool (20 max clients) |
| `lib/instagram.js` | Instagram Graph API client |
| `lib/metaAds.js` | Meta Ads API client |
| `lib/credentials.js` | OAuth token fetching |
| `lib/rateLimiter.js` | API rate limit handling |
| `jobs/backfill.js` | Initial 30-day data fetch |
| `jobs/dailySync.js` | Incremental daily sync |

### enrichment-worker
| File | Purpose |
|------|---------|
| `main.py` | Job processing loop, media type handling |
| `lib/embedder.py` | Vertex AI multimodal embeddings |
| `lib/transcriber.py` | Google Cloud Speech-to-Text |
| `lib/audio_extractor.py` | FFmpeg video/audio processing |

### MCP servers
| File | Purpose |
|------|---------|
| `server.js` | Tool definitions, API calls, MCP protocol |
| `http-wrapper.js` | Spawns server.js, handles HTTP ↔ stdio |

## Database Schema

All Meta nest data lives in the `nest_meta` database:

```sql
-- Core tables
instagram_posts          -- Posts with embeddings, transcripts
instagram_post_children  -- Carousel items
instagram_insights       -- Post performance metrics
sync_status             -- Per-client sync state
sync_jobs               -- Job queue for sync-worker
enrichment_jobs         -- Job queue for enrichment-worker
credentials             -- Encrypted OAuth tokens
```

Key columns in `instagram_posts`:
- `embedding` (vector 1408) - Multimodal embedding
- `transcript` - Video audio transcription
- `has_audio` - Whether video has audio track
- `embedded_at` - When embedding was generated

## Environment Variables

Required by workers (set in `app/.env`):

```bash
# Database
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_USER=
POSTGRES_PASSWORD=
POSTGRES_DB=nest_meta

# Google Cloud (enrichment-worker)
GOOGLE_API_KEY=
GOOGLE_CLOUD_PROJECT=
GOOGLE_APPLICATION_CREDENTIALS=/app/credentials/service-account.json
VERTEX_AI_LOCATION=us-central1

# Credential receiver
CREDENTIAL_RECEIVER_URL=http://aiviary-connect:3006
```

## Adding a New Nest

1. Create directory: `nests/<platform>/`
2. Add workers and/or MCP servers following existing patterns
3. Create database: Add to `shared/database/init.sh`
4. Add migrations: `shared/database/migrations/`
5. Add services to `docker-compose.yml`
6. Update credential types in `aiviary-connect` if needed

## Common Issues

**MCP server timeout**: Check that `aiviary-connect` is running and credentials exist

**Enrichment fails with "No audio track"**: Normal for images/silent videos - transcript stored as NULL

**Rate limit errors**: sync-worker handles this with backoff, but check `rateLimiter.js` stats

**Embedding dimension mismatch**: Ensure Vertex AI model matches schema (1408 dimensions)

## Testing

```bash
# Check sync worker job stats
docker logs meta-sync-worker | grep "System stats"

# Check enrichment queue
docker exec postgres psql -U postgres -d nest_meta \
  -c "SELECT status, COUNT(*) FROM enrichment_jobs GROUP BY status"

# Test MCP tool directly
curl -X POST http://localhost:3005/call \
  -H "Content-Type: application/json" \
  -d '{"tool": "get_media_with_insights", "arguments": {"limit": 5}}'
```
