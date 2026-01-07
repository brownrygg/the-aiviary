# Meta Nest

This nest handles all Meta platform integrations including Instagram Analytics, Meta Ads, and Meta Ad Library.

## Components

### Workers

#### sync-worker
Synchronizes data from Meta APIs to the `nest_meta` database:
- Instagram posts, stories, reels
- Post engagement metrics (likes, comments, shares)
- Follower/following counts
- Media insights

#### enrichment-worker
Adds AI-powered enhancements to synced data:
- Vector embeddings for semantic search
- Content categorization
- Sentiment analysis
- Engagement predictions

### MCP Servers

Model Context Protocol servers that provide real-time API access to the analytics agent:

| Server | Port | Purpose |
|--------|------|---------|
| `meta-ads-mcp` | 3004 | Meta Ads Manager API - campaigns, ad sets, ads |
| `instagram-analytics-mcp` | 3005 | Instagram Insights API - media, audience, engagement |
| `meta-ad-library-mcp` | 3007 | Ad Library API - competitor ad research |

## Database

All Meta nest data is stored in the `nest_meta` database:
- Isolated from other components
- Uses pgvector for embedding storage
- Migrations in `shared/database/migrations/`

## Environment Variables

Required in `.env`:
```env
# Meta API (via Aiviary Connect OAuth)
# No direct API keys needed - uses OAuth tokens from Connect

# Google Cloud (for enrichment embeddings)
GOOGLE_API_KEY=
GOOGLE_CLOUD_PROJECT=
GOOGLE_APPLICATION_CREDENTIALS=/app/credentials/service-account.json
VERTEX_AI_LOCATION=us-central1
```

## Adding/Removing This Nest

### To Remove
1. Remove Meta nest services from `docker-compose.yml`:
   - `meta-sync-worker`
   - `meta-enrichment-worker`
   - `meta-ads-mcp`
   - `instagram-analytics-mcp`
   - `meta-ad-library-mcp`
2. Optionally drop the database: `DROP DATABASE nest_meta;`
3. Remove `nests/meta/` directory

### To Add to New Deployment
1. Copy `nests/meta/` to the new deployment
2. Add services to `docker-compose.yml`
3. Add `nest_meta` database creation to `shared/database/init.sh`
4. Run `docker compose up -d`
