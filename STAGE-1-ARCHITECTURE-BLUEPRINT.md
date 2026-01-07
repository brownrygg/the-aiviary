# Stage 1: Detailed Architecture Blueprint & Deployment Mechanics

## I. System Overview

### Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    LAYER 1: CENTRAL HUB                      │
│                    (Single Instance)                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  nest-keeper                                                │
│  Location: oauth.yourdomain.com                             │
│  Purpose: Central OAuth broker for all platforms            │
│  Serves: All clients across all VMs                         │
│                                                              │
│  Components:                                                 │
│  ├─ Express.js OAuth server (port 3000)                     │
│  ├─ Platform handlers (8 platforms)                         │
│  │  ├─ Meta (Instagram, Facebook, Ads)                      │
│  │  ├─ Google (YouTube, Drive, Gmail)                       │
│  │  ├─ Asana                                                │
│  │  ├─ Monday.com                                           │
│  │  ├─ Slack                                                │
│  │  ├─ LinkedIn                                             │
│  │  ├─ TikTok                                               │
│  │  └─ Custom platforms (extensible)                        │
│  ├─ PostgreSQL: broker_db                                   │
│  │  ├─ client_vm_registry (maps client_id → VM URL)        │
│  │  ├─ oauth_events (audit log)                            │
│  │  └─ app_testers (Meta development mode)                 │
│  └─ Cloudflare Tunnel (public access)                       │
│                                                              │
│  Responsibilities:                                           │
│  ├─ Handle OAuth flows for all platforms                    │
│  ├─ Exchange authorization codes for tokens                 │
│  ├─ Discover platform accounts (Instagram ID, YouTube       │
│  │   channel, Asana workspace, etc.)                        │
│  ├─ Route credentials to correct client VM                  │
│  └─ Log all OAuth events for audit                          │
│                                                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                 LAYER 2: CLIENT VM CORE                      │
│              (One VM per client, always present)             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  credential-receiver                                         │
│  Port: 3006 (internal only)                                 │
│  Purpose: Receive and secure OAuth credentials              │
│                                                              │
│  Components:                                                 │
│  ├─ Express.js server                                       │
│  ├─ AES-256-CBC encryption/decryption                       │
│  └─ PostgreSQL: credentials_db                              │
│     └─ oauth_credentials table (encrypted tokens)           │
│                                                              │
│  Responsibilities:                                           │
│  ├─ Receive credentials from nest-keeper                    │
│  ├─ Validate VM_API_KEY for security                        │
│  ├─ Encrypt tokens before storage                           │
│  ├─ Serve decrypted tokens to nests (internal only)         │
│  └─ Notify nests when credentials arrive                    │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  aiviary-chat                                               │
│  Location: chat.clienta.yourdomain.com                      │
│  Purpose: AI agent interface with dynamic tool discovery    │
│                                                              │
│  Components:                                                 │
│  ├─ OpenWebUI (chat interface)                              │
│  ├─ AI Agent (Claude, GPT, etc.)                            │
│  ├─ Tool Registry (dynamic MCP + Hybrid tool discovery)     │
│  └─ Tool Router (routes queries to correct nest)            │
│                                                              │
│  Responsibilities:                                           │
│  ├─ Provide chat interface to end user                      │
│  ├─ Discover tools from deployed nests automatically        │
│  ├─ Route tool calls to appropriate nest MCP servers        │
│  ├─ Synthesize responses from multiple nests                │
│  └─ Handle conversational context and memory                │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  n8n (Stage 1 workflow engine)                              │
│  Location: n8n.clienta.yourdomain.com (Tailscale only)      │
│  Purpose: Workflow automation with nest tools               │
│                                                              │
│  Components:                                                 │
│  ├─ n8n server (port 5678)                                  │
│  ├─ n8n-worker (execution worker)                           │
│  └─ PostgreSQL: n8n_db                                      │
│                                                              │
│  Responsibilities:                                           │
│  ├─ Execute scheduled workflows                             │
│  ├─ Call MCP tools from nests                               │
│  ├─ Call Hybrid Search tools from nests                     │
│  ├─ Store workflow definitions and execution logs           │
│  └─ Trigger actions based on conditions                     │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  nginx                                                       │
│  Purpose: Reverse proxy and SSL termination                 │
│                                                              │
│  Routes:                                                     │
│  ├─ / → Static onboarding page                             │
│  ├─ /api/credentials → credential-receiver:3006             │
│  ├─ chat.{domain} → open-webui:4002                        │
│  ├─ n8n.{domain} → n8n:5678 (Tailscale only)               │
│  └─ nocodb.{domain} → nocodb:8080 (if deployed)            │
│                                                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│              LAYER 3: PLATFORM NESTS                         │
│            (Deployed on-demand per client needs)             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Each nest is a self-contained microservice with:           │
│  ├─ Sync-worker (platform-specific API logic)               │
│  ├─ Enrichment-worker (AI processing)                       │
│  ├─ PostgreSQL database (platform schema)                   │
│  ├─ MCP servers (real-time API tools)                       │
│  └─ Hybrid search tools (database query tools)              │
│                                                              │
│  Nests communicate with core via:                            │
│  ├─ credential-receiver (fetch OAuth tokens)                │
│  └─ aiviary-chat (register tools, receive queries)          │
│                                                              │
│  Nests are completely independent:                           │
│  ├─ Own deployment lifecycle                                │
│  ├─ Own database schema and migrations                      │
│  ├─ Own API versioning                                      │
│  └─ Can be added/removed without affecting other nests      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## II. Meta-Nest: Reference Implementation

### Architecture Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                    meta-content-nest                          │
│                    Docker Container                           │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ SYNC-WORKER (Meta Platform Specialist)                 │ │
│  ├────────────────────────────────────────────────────────┤ │
│  │                                                         │ │
│  │  Purpose: Fetch Instagram & Meta Ads data via APIs     │ │
│  │                                                         │ │
│  │  Job Polling Loop:                                      │ │
│  │  ├─ Poll meta_db.sync_jobs every 60 seconds           │ │
│  │  ├─ FOR UPDATE SKIP LOCKED (atomic job claiming)      │ │
│  │  └─ Process: backfill, daily_sync, on_demand          │ │
│  │                                                         │ │
│  │  Credential Access:                                     │ │
│  │  └─ GET credential-receiver:3006/api/credentials/token │ │
│  │     └─ Receives decrypted access_token + metadata     │ │
│  │                                                         │ │
│  │  Meta Graph API Calls:                                  │ │
│  │  ├─ GET /instagram_business_account (profile)          │ │
│  │  ├─ GET /media (all posts)                            │ │
│  │  ├─ GET /insights (account & post metrics)            │ │
│  │  ├─ GET /adaccounts (ad campaigns)                    │ │
│  │  └─ Rate limiting: 200 req/hour                       │ │
│  │                                                         │ │
│  │  Data Storage:                                          │ │
│  │  └─ INSERT/UPDATE into meta_db tables:                │ │
│  │     ├─ instagram_account_profile                       │ │
│  │     ├─ instagram_posts                                 │ │
│  │     ├─ instagram_post_insights                         │ │
│  │     ├─ instagram_follower_history                      │ │
│  │     ├─ ad_campaigns                                    │ │
│  │     └─ ad_campaign_insights                            │ │
│  │                                                         │ │
│  │  Job Creation:                                          │ │
│  │  └─ For each post synced:                             │ │
│  │     INSERT INTO enrichment_jobs (status='pending')    │ │
│  │                                                         │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ ENRICHMENT-WORKER (AI Intelligence Layer)              │ │
│  ├────────────────────────────────────────────────────────┤ │
│  │                                                         │ │
│  │  Purpose: Generate embeddings & transcripts            │ │
│  │                                                         │ │
│  │  Job Polling Loop:                                      │ │
│  │  ├─ Poll meta_db.enrichment_jobs every 30 seconds     │ │
│  │  ├─ FOR UPDATE SKIP LOCKED                            │ │
│  │  └─ Process content_type='instagram_posts'            │ │
│  │                                                         │ │
│  │  Processing Pipeline:                                   │ │
│  │  1. Fetch post from meta_db.instagram_posts           │ │
│  │  2. Download media from Instagram CDN                  │ │
│  │  3. If VIDEO:                                          │ │
│  │     ├─ Extract audio with FFmpeg                       │ │
│  │     ├─ Transcribe with Google Speech-to-Text          │ │
│  │     └─ Store transcript in instagram_posts            │ │
│  │  4. Generate embedding:                                │ │
│  │     ├─ Google Vertex AI multimodalembedding@001       │ │
│  │     ├─ Input: caption + transcript + image/video      │ │
│  │     └─ Output: 1408-dimension vector                   │ │
│  │  5. Store embedding in instagram_posts.embedding      │ │
│  │  6. Mark enrichment_job as completed                  │ │
│  │                                                         │ │
│  │  Retry Strategy:                                        │ │
│  │  ├─ Max 3 attempts                                     │ │
│  │  └─ Exponential backoff (5, 10, 20 minutes)           │ │
│  │                                                         │ │
│  │  Cost Tracking:                                         │ │
│  │  ├─ ~$0.025 per 1000 embeddings                       │ │
│  │  └─ ~$0.016 per minute of transcription               │ │
│  │                                                         │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ META_DB (PostgreSQL with pgvector)                     │ │
│  ├────────────────────────────────────────────────────────┤ │
│  │                                                         │ │
│  │  Core Data Tables:                                      │ │
│  │  ├─ instagram_account_profile                          │ │
│  │  ├─ instagram_follower_history                         │ │
│  │  ├─ instagram_posts (with embedding vector(1408))     │ │
│  │  ├─ instagram_post_children (carousels)               │ │
│  │  ├─ instagram_post_insights                            │ │
│  │  ├─ instagram_account_insights                         │ │
│  │  ├─ instagram_audience_demographics (JSONB)           │ │
│  │  ├─ ad_campaigns                                       │ │
│  │  ├─ ad_campaign_insights                               │ │
│  │  ├─ ad_sets                                            │ │
│  │  ├─ ads                                                │ │
│  │  └─ ad_insights                                        │ │
│  │                                                         │ │
│  │  Orchestration Tables:                                  │ │
│  │  ├─ sync_jobs (backfill, daily_sync queue)           │ │
│  │  ├─ enrichment_jobs (AI processing queue)             │ │
│  │  └─ sync_status (per-client tracking)                 │ │
│  │                                                         │ │
│  │  SQL Helper Functions (13 adaptive functions):         │ │
│  │  ├─ get_top_posts_adaptive()                          │ │
│  │  ├─ compare_periods_adaptive()                        │ │
│  │  ├─ get_engagement_rate_adaptive()                    │ │
│  │  ├─ analyze_content_types()                           │ │
│  │  ├─ get_best_posting_times()                          │ │
│  │  ├─ find_top_hashtags()                               │ │
│  │  ├─ get_follower_growth()                             │ │
│  │  ├─ get_audience_breakdown()                          │ │
│  │  ├─ calculate_retention_rate()                        │ │
│  │  ├─ get_ad_performance_summary()                      │ │
│  │  ├─ calculate_cost_per_engagement()                   │ │
│  │  ├─ compare_campaign_efficiency()                     │ │
│  │  └─ get_client_data_availability()                    │ │
│  │                                                         │ │
│  │  Vector Search Functions:                              │ │
│  │  ├─ find_similar_posts(post_id, limit)                │ │
│  │  └─ search_posts_by_embedding(query_vector, threshold)│ │
│  │                                                         │ │
│  │  Indexes:                                               │ │
│  │  ├─ HNSW index on embedding column (fast similarity)  │ │
│  │  ├─ B-tree on timestamps (time-range queries)         │ │
│  │  ├─ GIN on transcript (full-text search)              │ │
│  │  └─ Composite indexes on (client_id, created_at)      │ │
│  │                                                         │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ MCP SERVERS (Real-time API Tools)                      │ │
│  ├────────────────────────────────────────────────────────┤ │
│  │                                                         │ │
│  │  meta-ads-mcp (Port 3004)                              │ │
│  │  ├─ Tool: get_current_ad_campaigns()                  │ │
│  │  ├─ Tool: get_campaign_performance(campaign_id)       │ │
│  │  ├─ Tool: update_campaign_budget(campaign_id, budget) │ │
│  │  └─ Calls: Meta Graph API v21.0 /adaccounts           │ │
│  │                                                         │ │
│  │  instagram-analytics-mcp (Port 3005)                   │ │
│  │  ├─ Tool: get_current_follower_count()                │ │
│  │  ├─ Tool: get_recent_posts(hours)                     │ │
│  │  ├─ Tool: get_story_insights()                        │ │
│  │  └─ Calls: Instagram Graph API                        │ │
│  │                                                         │ │
│  │  meta-ad-library-mcp (Port 3007)                       │ │
│  │  ├─ Tool: search_competitor_ads(keywords, country)    │ │
│  │  ├─ Tool: analyze_competitor_creative(ad_id)          │ │
│  │  └─ Calls: Meta Ad Library API (public)               │ │
│  │                                                         │ │
│  │  All MCP servers:                                       │ │
│  │  ├─ Fetch credentials from credential-receiver        │ │
│  │  ├─ Never store tokens (memory only)                  │ │
│  │  └─ Register tools with aiviary-chat on startup       │ │
│  │                                                         │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ HYBRID SEARCH TOOLS (Database Intelligence)            │ │
│  ├────────────────────────────────────────────────────────┤ │
│  │                                                         │ │
│  │  Tool Server: hybrid-search-api (Port 3020)            │ │
│  │                                                         │ │
│  │  Semantic Search Tools:                                 │ │
│  │  ├─ search_posts_semantic(query_text, limit)          │ │
│  │  │  └─ Generate query embedding → vector search       │ │
│  │  ├─ find_similar_posts(post_id, limit)                │ │
│  │  │  └─ Use post's embedding → cosine similarity       │ │
│  │  └─ search_by_transcript(keywords)                    │ │
│  │     └─ Full-text search on video transcriptions       │ │
│  │                                                         │ │
│  │  SQL Analytics Tools (13 functions):                   │ │
│  │  ├─ get_top_posts(metric, limit, days)                │ │
│  │  ├─ compare_periods(metric, period1, period2)         │ │
│  │  ├─ analyze_content_types()                           │ │
│  │  ├─ get_engagement_trends()                           │ │
│  │  ├─ get_audience_demographics()                       │ │
│  │  └─ ... (maps to SQL helper functions)                │ │
│  │                                                         │ │
│  │  All tools:                                             │ │
│  │  ├─ Query meta_db directly (no API calls)             │ │
│  │  ├─ Return structured data (JSON)                     │ │
│  │  ├─ No rate limits                                    │ │
│  │  ├─ Sub-second response time                          │ │
│  │  └─ Register with aiviary-chat on startup             │ │
│  │                                                         │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
│  Tool Registration on Startup:                               │
│  POST aiviary-chat:4002/api/tools/register                   │
│  {                                                            │
│    "nest_id": "meta-content-nest",                           │
│    "nest_version": "v2.3.1",                                 │
│    "mcp_tools": [                                             │
│      {                                                        │
│        "name": "meta_get_current_follower_count",            │
│        "category": "real-time",                              │
│        "endpoint": "http://instagram-analytics-mcp:3005",    │
│        "description": "Get current Instagram follower count" │
│      },                                                       │
│      ... (all MCP tools)                                     │
│    ],                                                         │
│    "hybrid_tools": [                                          │
│      {                                                        │
│        "name": "meta_search_posts_semantic",                 │
│        "category": "hybrid-search",                          │
│        "endpoint": "http://hybrid-search-api:3020",          │
│        "description": "Semantic search across Instagram posts"│
│      },                                                       │
│      ... (all hybrid tools)                                  │
│    ]                                                          │
│  }                                                            │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### Data Flow: OAuth to Intelligence

```
PHASE 1: OAuth Connection
━━━━━━━━━━━━━━━━━━━━━━━━━━
User clicks "Connect Instagram"
    ↓
Browser → nest-keeper/auth/meta?client_id=clienta
    ↓
nest-keeper redirects to Meta OAuth
    ↓
User authorizes on Meta
    ↓
Meta → nest-keeper/callback?code=ABC123
    ↓
nest-keeper exchanges code for 60-day access token
nest-keeper discovers Instagram Business Account ID
    ↓
POST clienta.domain.com:3006/api/credentials
Headers: X-API-Key: <vm_api_key>
Body: {
  platform: "meta",
  access_token: "...",
  token_expires_at: "...",
  platform_data: {
    instagram_business_account_id: "...",
    ad_account_id: "..."
  }
}
    ↓
credential-receiver:
  ├─ Validates API key
  ├─ Encrypts token (AES-256)
  ├─ Stores in credentials_db
  └─ Notifies meta-nest: "credentials ready"

PHASE 2: Backfill Sync
━━━━━━━━━━━━━━━━━━━━━━━━━━
credential-receiver creates sync job:
INSERT INTO meta_db.sync_jobs
  (client_id, job_type, priority, status)
VALUES
  ('client', 'backfill', 100, 'pending')
    ↓
sync-worker polling loop (every 60s):
  SELECT * FROM sync_jobs
  WHERE status = 'pending'
  ORDER BY priority DESC
  FOR UPDATE SKIP LOCKED
  LIMIT 1
    ↓
Job found → UPDATE status = 'processing'
    ↓
Fetch credentials:
  GET credential-receiver:3006/api/credentials/token?platform=meta
  Response: { access_token: "...", instagram_business_account_id: "..." }
    ↓
Call Meta Graph API:
  1. GET /{instagram_business_account_id}
     → Store in instagram_account_profile

  2. GET /{instagram_business_account_id}/media
     → Paginate through all posts (last 30 days)
     → For each post:
        INSERT INTO instagram_posts
        INSERT INTO enrichment_jobs (status='pending')

  3. GET /{media_id}/insights for each post
     → Store in instagram_post_insights

  4. GET /{instagram_business_account_id}/insights
     → Store in instagram_account_insights

  5. GET /{ad_account_id}/campaigns (if ad account exists)
     → Store in ad_campaigns

  6. GET /{campaign_id}/insights
     → Store in ad_campaign_insights
    ↓
UPDATE sync_jobs SET status = 'completed'
UPDATE sync_status SET backfill_completed = true

PHASE 3: AI Enrichment
━━━━━━━━━━━━━━━━━━━━━━━━━━
enrichment-worker polling loop (every 30s):
  SELECT * FROM enrichment_jobs
  WHERE status = 'pending'
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1
    ↓
Job found → UPDATE status = 'processing'
    ↓
Fetch post:
  SELECT * FROM instagram_posts WHERE id = {content_id}
    ↓
Download media from media_url (Instagram CDN)
    ↓
IF media_type = 'VIDEO':
  ├─ Extract audio with FFmpeg
  ├─ Transcribe with Google Speech-to-Text
  ├─ UPDATE instagram_posts SET transcript = "..."
  └─ contextual_text = caption + " " + transcript
ELSE:
  └─ contextual_text = caption
    ↓
Generate embedding:
  Google Vertex AI multimodalembedding@001
  Input: {
    image: media_url (or thumbnail_url for video),
    contextual_text: contextual_text,
    dimension: 1408
  }
  Output: [0.123, -0.456, ..., 0.789] (1408 floats)
    ↓
UPDATE instagram_posts
  SET embedding = '[0.123, ...]',
      embedded_at = NOW(),
      embedding_model = 'embedding-001'
    ↓
UPDATE enrichment_jobs SET status = 'completed'

PHASE 4: Tool Activation
━━━━━━━━━━━━━━━━━━━━━━━━━━
meta-nest startup sequence:
  1. Start all services (sync, enrichment, MCP, hybrid)
  2. Run database migrations
  3. Wait for health checks
  4. Register tools with aiviary-chat:
     POST /api/tools/register
     { mcp_tools: [...], hybrid_tools: [...] }
    ↓
aiviary-chat receives registration:
  ├─ Add tools to agent's available functions
  ├─ Update UI with "Instagram connected" status
  └─ Agent can now call meta tools
    ↓
User asks: "Show me my best posts this week"
    ↓
Agent decides:
  ├─ Tool: meta_get_top_posts
  ├─ Parameters: {metric: "reach", limit: 10, days: 7}
  └─ Endpoint: http://hybrid-search-api:3020/get_top_posts
    ↓
hybrid-search-api:
  ├─ Executes: SELECT * FROM get_top_posts_adaptive('reach', 10, 7)
  ├─ Returns: [{post_id, media_type, timestamp, reach, engagement_rate}, ...]
  └─ Response time: ~50ms
    ↓
Agent receives data and synthesizes response:
  "Your top posts this week were:
   1. Carousel about product launch (50K reach, 8% engagement)
   2. Reel about behind-the-scenes (42K reach, 6.5% engagement)
   ..."

PHASE 5: Daily Sync (Automatic)
━━━━━━━━━━━━━━━━━━━━━━━━━━
Cron schedule: Daily at 4:00 AM
    ↓
sync-worker scheduleDailySyncJobs():
  INSERT INTO sync_jobs
    (client_id, job_type, priority, status)
  VALUES
    ('client', 'daily_sync', 75, 'pending')
    ↓
Polling loop picks up job:
    ↓
Smart update strategy:
  ├─ Posts < 7 days old: Update insights daily
  ├─ Posts 7-30 days old: Update insights weekly (Mondays)
  └─ Posts > 30 days old: Skip (stable data)
    ↓
For new posts found:
  ├─ INSERT INTO instagram_posts
  └─ INSERT INTO enrichment_jobs
    ↓
enrichment-worker processes new posts
    ↓
Hybrid tools now include fresh data
```

---

## III. YouTube-Nest: Seamless Integration Blueprint

### Architectural Alignment

YouTube-nest follows the exact same pattern as meta-nest but with YouTube-specific components.

```
┌──────────────────────────────────────────────────────────────┐
│                  youtube-content-nest                         │
│                  Docker Container                             │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ SYNC-WORKER (YouTube Platform Specialist)              │ │
│  ├────────────────────────────────────────────────────────┤ │
│  │                                                         │ │
│  │  YouTube Data API v3 Client                            │ │
│  │                                                         │ │
│  │  Backfill Job:                                          │ │
│  │  ├─ GET /channels (channel info)                       │ │
│  │  ├─ GET /search (all videos from channel)             │ │
│  │  ├─ GET /videos (video details, batch 50)             │ │
│  │  └─ Rate limit: 10,000 quota units/day                │ │
│  │                                                         │ │
│  │  YouTube Analytics API:                                 │ │
│  │  ├─ GET /reports (channel-level metrics)              │ │
│  │  ├─ GET /reports (per-video metrics)                  │ │
│  │  └─ Metrics: views, watch_time, subscribers_gained    │ │
│  │                                                         │ │
│  │  Data Storage:                                          │ │
│  │  ├─ youtube_channels                                   │ │
│  │  ├─ youtube_videos                                     │ │
│  │  ├─ youtube_video_insights (daily snapshots)          │ │
│  │  ├─ youtube_channel_insights                           │ │
│  │  └─ youtube_comments (optional)                        │ │
│  │                                                         │ │
│  │  Job Creation:                                          │ │
│  │  └─ INSERT INTO enrichment_jobs for each video        │ │
│  │                                                         │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ ENRICHMENT-WORKER (YouTube Video Intelligence)         │ │
│  ├────────────────────────────────────────────────────────┤ │
│  │                                                         │ │
│  │  Processing Pipeline:                                   │ │
│  │  1. Fetch video from youtube_db.youtube_videos        │ │
│  │  2. Extract subtitle/caption (if available):           │ │
│  │     ├─ GET /captions (YouTube API)                    │ │
│  │     ├─ Download subtitle file (SRT/VTT)               │ │
│  │     └─ Store in youtube_videos.subtitle               │ │
│  │  3. If no subtitle available:                          │ │
│  │     ├─ Download video audio                           │ │
│  │     ├─ Transcribe with Google Speech-to-Text         │ │
│  │     └─ Store in youtube_videos.transcript             │ │
│  │  4. Generate embedding:                                │ │
│  │     ├─ Input: title + description + subtitle/transcript│ │
│  │     │         + video thumbnail                        │ │
│  │     └─ Output: 1408-dimension vector                   │ │
│  │  5. Topic extraction (optional):                       │ │
│  │     ├─ Use Claude to categorize video topics          │ │
│  │     └─ Store in youtube_videos.topics (JSONB array)   │ │
│  │  6. Store embedding in youtube_videos.embedding       │ │
│  │                                                         │ │
│  │  Key Difference from Meta:                             │ │
│  │  ├─ Subtitles preferred over transcription (faster)   │ │
│  │  ├─ Longer content (10-60 min videos vs 60s Reels)   │ │
│  │  └─ Topic categorization more valuable                │ │
│  │                                                         │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ YOUTUBE_DB (PostgreSQL with pgvector)                  │ │
│  ├────────────────────────────────────────────────────────┤ │
│  │                                                         │ │
│  │  Core Tables:                                           │ │
│  │  ├─ youtube_channels                                   │ │
│  │  │  └─ channel_id, title, subscriber_count, etc.      │ │
│  │  ├─ youtube_videos                                     │ │
│  │  │  ├─ video_id, title, description                   │ │
│  │  │  ├─ duration, published_at                          │ │
│  │  │  ├─ view_count, like_count, comment_count          │ │
│  │  │  ├─ subtitle TEXT (from YouTube captions)          │ │
│  │  │  ├─ transcript TEXT (from Speech-to-Text)          │ │
│  │  │  ├─ topics JSONB (AI-extracted categories)         │ │
│  │  │  └─ embedding vector(1408)                          │ │
│  │  ├─ youtube_video_insights                             │ │
│  │  │  ├─ video_id, snapshot_date                        │ │
│  │  │  ├─ views, watch_time_minutes                      │ │
│  │  │  ├─ average_view_duration                          │ │
│  │  │  ├─ likes, comments, shares                        │ │
│  │  │  └─ subscriber_change                               │ │
│  │  ├─ youtube_channel_insights                           │ │
│  │  │  └─ Daily channel metrics                          │ │
│  │  └─ youtube_audience_demographics (JSONB)             │ │
│  │                                                         │ │
│  │  SQL Helper Functions (YouTube-specific):              │ │
│  │  ├─ get_top_videos_adaptive(metric, limit, days)     │ │
│  │  ├─ analyze_video_duration_performance()              │ │
│  │  ├─ get_subscriber_growth_rate()                      │ │
│  │  ├─ find_trending_topics()                            │ │
│  │  ├─ calculate_watch_time_retention()                  │ │
│  │  ├─ compare_video_performance(video1, video2)         │ │
│  │  └─ get_upload_frequency_correlation()                │ │
│  │                                                         │ │
│  │  Vector Search:                                         │ │
│  │  ├─ find_similar_videos(video_id, limit)              │ │
│  │  └─ search_videos_by_embedding(query_vector)          │ │
│  │                                                         │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ MCP SERVERS (YouTube Real-time)                        │ │
│  ├────────────────────────────────────────────────────────┤ │
│  │                                                         │ │
│  │  youtube-analytics-mcp (Port 3008)                     │ │
│  │  ├─ get_current_subscriber_count()                    │ │
│  │  ├─ get_realtime_views(video_id)                      │ │
│  │  ├─ get_live_stream_stats()                           │ │
│  │  └─ get_recent_comments(hours)                        │ │
│  │                                                         │ │
│  │  youtube-studio-mcp (Port 3009)                        │ │
│  │  ├─ update_video_metadata(video_id, title, desc)     │ │
│  │  ├─ schedule_video_publish(video_id, datetime)        │ │
│  │  ├─ manage_playlists()                                │ │
│  │  └─ moderate_comments(video_id)                       │ │
│  │                                                         │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ HYBRID SEARCH TOOLS (YouTube Intelligence)             │ │
│  ├────────────────────────────────────────────────────────┤ │
│  │                                                         │ │
│  │  hybrid-search-api (Port 3021)                         │ │
│  │                                                         │ │
│  │  Semantic Search:                                       │ │
│  │  ├─ search_videos_semantic(query, limit)              │ │
│  │  ├─ find_similar_videos(video_id, limit)              │ │
│  │  ├─ search_by_subtitle(keywords)                      │ │
│  │  └─ search_by_topic(topic_name)                       │ │
│  │                                                         │ │
│  │  SQL Analytics:                                         │ │
│  │  ├─ get_top_videos(metric, limit, days)               │ │
│  │  ├─ analyze_upload_patterns()                         │ │
│  │  ├─ get_subscriber_trends()                           │ │
│  │  ├─ compare_video_types()                             │ │
│  │  └─ get_audience_retention_by_duration()              │ │
│  │                                                         │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### Key YouTube-Specific Considerations

**1. Quota Management**
- YouTube Data API has quota limit (10,000 units/day)
- Some operations expensive (video details = 1 unit, search = 100 units)
- sync-worker must track quota usage and pause if near limit
- Store quota_usage in youtube_db for monitoring

**2. Subtitle Extraction Priority**
- YouTube provides auto-generated or manual subtitles
- Prefer YouTube subtitles (faster, free) over Speech-to-Text (slower, costs money)
- Only transcribe if no subtitles available

**3. Longer Content Duration**
- Instagram: 60-90 second videos
- YouTube: 10-60 minute videos
- Chunk processing for embeddings (summarize long transcripts)
- More expensive enrichment costs per video

**4. Different Metrics**
- YouTube: Watch time, average view duration, subscriber change
- Instagram: Reach, saves, interactions
- SQL helper functions need YouTube-specific calculations

**5. Community Features**
- YouTube has comments, playlists, community posts
- Optional: Sync and enrich comments for sentiment analysis
- Optional: Analyze playlist performance

### Deployment Integration

**Adding YouTube to Existing Client:**

```
Step 1: Client requests YouTube integration
    ↓
Step 2: Deploy youtube-nest container
    docker compose --profile youtube up -d
    ↓
Step 3: youtube-nest startup:
    ├─ Run youtube_db migrations
    ├─ Start sync-worker (idle, waiting for credentials)
    ├─ Start enrichment-worker (idle)
    ├─ Start MCP servers
    ├─ Start hybrid-search-api
    └─ Register tools with aiviary-chat
    ↓
Step 4: aiviary-chat updates:
    ├─ Agent gains YouTube tools
    └─ UI shows "Connect YouTube" button
    ↓
Step 5: Client clicks "Connect YouTube"
    ↓
Step 6: OAuth flow (through nest-keeper)
    ├─ Google OAuth (YouTube scopes)
    ├─ nest-keeper gets channel_id
    └─ Credentials → credential-receiver
    ↓
Step 7: YouTube backfill starts automatically
    ↓
Step 8: Enrichment processes all videos
    ↓
Step 9: Agent can now answer cross-platform questions:
    "Compare my Instagram vs YouTube engagement"
```

**No Impact on Meta-Nest:**
- Meta continues syncing daily
- Meta tools still available
- Meta database untouched
- Independent lifecycle

---

## IV. Asana-Nest: Integration Blueprint

Asana is different - it's an **n8n-only integration** (no sync-worker or enrichment-worker needed).

```
┌──────────────────────────────────────────────────────────────┐
│                    asana-content-nest                         │
│                    Docker Container                           │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ N8N-CREDENTIAL-IMPORTER                                 │ │
│  ├────────────────────────────────────────────────────────┤ │
│  │                                                         │ │
│  │  Purpose: Auto-import Asana credentials to n8n         │ │
│  │                                                         │ │
│  │  Watches for credentials:                               │ │
│  │  ├─ Polls credential-receiver every 60s                │ │
│  │  └─ GET /api/credentials?platform=asana                │ │
│  │                                                         │ │
│  │  When credentials found:                                │ │
│  │  1. Fetch decrypted token from credential-receiver     │ │
│  │  2. POST to n8n API:                                   │ │
│  │     POST n8n:5678/api/v1/credentials                   │ │
│  │     Headers: X-N8N-API-KEY                             │ │
│  │     Body: {                                            │ │
│  │       name: "Asana - {workspace_name}",               │ │
│  │       type: "asanaOAuth2Api",                          │ │
│  │       data: {                                          │ │
│  │         accessToken: "...",                           │ │
│  │         refreshToken: "...",                          │ │
│  │         workspaceId: "..."                            │ │
│  │       }                                                │ │
│  │     }                                                  │ │
│  │  3. Log success                                        │ │
│  │  4. Mark credential as imported (prevent duplicates)   │ │
│  │                                                         │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ ASANA-MCP (Optional - for agent direct access)         │ │
│  ├────────────────────────────────────────────────────────┤ │
│  │                                                         │ │
│  │  Port: 3010                                             │ │
│  │                                                         │ │
│  │  Real-time API Tools:                                   │ │
│  │  ├─ get_my_tasks(workspace_id)                        │ │
│  │  ├─ create_task(project_id, title, description)       │ │
│  │  ├─ update_task(task_id, fields)                      │ │
│  │  ├─ get_project_status(project_id)                    │ │
│  │  ├─ list_projects(workspace_id)                       │ │
│  │  ├─ search_tasks(query, workspace_id)                 │ │
│  │  └─ get_task_dependencies(task_id)                    │ │
│  │                                                         │ │
│  │  Credential Access:                                     │ │
│  │  └─ GET credential-receiver:3006/api/credentials/token│ │
│  │                                                         │ │
│  │  Calls Asana REST API directly (no local database)     │ │
│  │                                                         │ │
│  │  Register with aiviary-chat on startup                 │ │
│  │                                                         │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
│  NO DATABASE - All queries go directly to Asana API         │
│  NO SYNC-WORKER - n8n polls Asana on-demand                 │
│  NO ENRICHMENT-WORKER - No AI processing needed            │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### Asana Integration Philosophy

**Why No Database?**
- Asana is task management, not analytics
- Data changes frequently (tasks completed, priorities shift)
- Syncing would create stale data quickly
- Better to query Asana API in real-time

**Why No Enrichment?**
- Task titles and descriptions don't benefit from embeddings
- No rich media to process
- Semantic search less valuable (structured data already queryable)

**n8n Workflows Are Primary Interface:**
- "Create Asana task when Instagram post reaches 10K likes"
- "Send daily digest of completed tasks to Slack"
- "Sync Instagram content calendar to Asana projects"

**Agent Access Is Secondary:**
- "What tasks are due this week?" → asana-mcp queries API
- "Create a task to review top posts" → asana-mcp creates task
- Fast, real-time, no sync overhead

### Deployment Integration

```
Step 1: Deploy asana-nest
    docker compose --profile asana up -d
    ↓
Step 2: asana-nest startup:
    ├─ Start n8n-credential-importer
    ├─ Start asana-mcp
    └─ Register tools with aiviary-chat
    ↓
Step 3: Client clicks "Connect Asana"
    ↓
Step 4: OAuth flow (through nest-keeper)
    ├─ Asana OAuth
    ├─ Get workspace_gid
    └─ Credentials → credential-receiver
    ↓
Step 5: n8n-credential-importer detects new credential
    └─ Auto-imports to n8n
    ↓
Step 6: Client builds workflows in n8n
    └─ Asana node now has credentials pre-filled
    ↓
Step 7: Agent can answer:
    "What are my tasks this week?"
    "Create task to review Instagram analytics"
```

### Other n8n-Only Nests (Same Pattern)

**google-drive-nest:**
- n8n-credential-importer for Google Drive OAuth
- drive-mcp for agent queries ("Search my files for...")
- No database, no sync, no enrichment

**slack-nest:**
- n8n-credential-importer
- slack-mcp for posting messages via agent
- No database

**notion-nest:**
- n8n-credential-importer
- notion-mcp for database queries
- Optional: Sync Notion databases for offline analysis

**Rule of Thumb:**
- **Analytics platforms** (Instagram, YouTube, TikTok): Full nest with sync + enrichment + database
- **Action platforms** (Asana, Slack, Notion): n8n-only nest with MCP for agent access

---

## V. Tool Discovery & Registration System

### Dynamic Tool Registry Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     aiviary-chat                              │
│                  Tool Registry System                         │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ TOOL REGISTRY (In-Memory + Persistent)                 │ │
│  ├────────────────────────────────────────────────────────┤ │
│  │                                                         │ │
│  │  Data Structure:                                        │ │
│  │  {                                                      │ │
│  │    "meta-content-nest": {                              │ │
│  │      "version": "v2.3.1",                              │ │
│  │      "status": "active",                               │ │
│  │      "registered_at": "2025-01-06T10:00:00Z",         │ │
│  │      "mcp_tools": [                                    │ │
│  │        {                                               │ │
│  │          "id": "meta_get_current_follower_count",     │ │
│  │          "name": "Get Current Instagram Followers",   │ │
│  │          "category": "real-time",                     │ │
│  │          "endpoint": "http://instagram-mcp:3005/...", │ │
│  │          "parameters": {...},                         │ │
│  │          "description": "...",                        │ │
│  │          "cost": "1 API call"                         │ │
│  │        },                                              │ │
│  │        ...                                             │ │
│  │      ],                                                │ │
│  │      "hybrid_tools": [                                 │ │
│  │        {                                               │ │
│  │          "id": "meta_search_posts_semantic",          │ │
│  │          "name": "Semantic Search Instagram Posts",   │ │
│  │          "category": "hybrid-search",                 │ │
│  │          "endpoint": "http://hybrid-api:3020/...",    │ │
│  │          "parameters": {...},                         │ │
│  │          "description": "...",                        │ │
│  │          "cost": "free"                               │ │
│  │        },                                              │ │
│  │        ...                                             │ │
│  │      ]                                                 │ │
│  │    },                                                  │ │
│  │    "youtube-content-nest": {...},                     │ │
│  │    "asana-content-nest": {...}                        │ │
│  │  }                                                     │ │
│  │                                                         │ │
│  │  API Endpoints:                                         │ │
│  │  ├─ POST /api/tools/register                          │ │
│  │  │  └─ Called by nests on startup                     │ │
│  │  ├─ DELETE /api/tools/unregister/{nest_id}           │ │
│  │  │  └─ Called by nests on shutdown                    │ │
│  │  ├─ GET /api/tools/list                               │ │
│  │  │  └─ Returns all available tools                    │ │
│  │  └─ GET /api/tools/health                             │ │
│  │     └─ Pings all nests, marks dead ones               │ │
│  │                                                         │ │
│  │  Health Checking:                                       │ │
│  │  ├─ Every 5 minutes, ping each nest's health endpoint │ │
│  │  ├─ If nest unreachable 3 times, mark status="dead"  │ │
│  │  └─ Remove dead nest's tools from agent               │ │
│  │                                                         │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ AGENT CONFIGURATION (Auto-Updated)                     │ │
│  ├────────────────────────────────────────────────────────┤ │
│  │                                                         │ │
│  │  When tools registered/unregistered:                   │ │
│  │  ├─ Update agent's system prompt with available tools │ │
│  │  ├─ Categorize tools by type:                         │ │
│  │  │  ├─ Real-time (expensive, current data)            │ │
│  │  │  ├─ Hybrid (fast, historical data)                 │ │
│  │  │  └─ Action (creates/updates data)                  │ │
│  │  └─ Provide guidance on when to use each type         │ │
│  │                                                         │ │
│  │  Agent Prompt Template:                                │ │
│  │  "You have access to the following tools:             │ │
│  │                                                         │ │
│  │   INSTAGRAM TOOLS (meta-content-nest):                │ │
│  │   Real-time:                                           │ │
│  │   - meta_get_current_follower_count() [1 API call]   │ │
│  │   Hybrid Search:                                       │ │
│  │   - meta_search_posts_semantic(query) [free, fast]   │ │
│  │   - meta_get_top_posts(metric, days) [free]          │ │
│  │                                                         │ │
│  │   YOUTUBE TOOLS (youtube-content-nest):               │ │
│  │   Real-time:                                           │ │
│  │   - youtube_get_current_subscribers() [1 API call]   │ │
│  │   Hybrid Search:                                       │ │
│  │   - youtube_search_videos_semantic(query) [free]     │ │
│  │                                                         │ │
│  │   ASANA TOOLS (asana-content-nest):                   │ │
│  │   Real-time:                                           │ │
│  │   - asana_get_my_tasks() [1 API call]                │ │
│  │   - asana_create_task(title, project) [1 API call]   │ │
│  │                                                         │ │
│  │   Prefer hybrid search tools for analysis questions.   │ │
│  │   Use real-time tools only for current state or       │ │
│  │   actions."                                            │ │
│  │                                                         │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ TOOL ROUTER (Call Dispatcher)                          │ │
│  ├────────────────────────────────────────────────────────┤ │
│  │                                                         │ │
│  │  When agent calls a tool:                              │ │
│  │  1. Parse tool_id (e.g., "meta_search_posts_semantic")│ │
│  │  2. Look up endpoint in registry                       │ │
│  │  3. Validate parameters against tool schema            │ │
│  │  4. HTTP POST to nest's endpoint                       │ │
│  │  5. Handle response:                                    │ │
│  │     ├─ Success: Return data to agent                  │ │
│  │     ├─ Error 503: Nest unavailable, mark dead         │ │
│  │     └─ Error 4xx/5xx: Return error to agent           │ │
│  │  6. Log call (tool_id, duration, result, cost)        │ │
│  │                                                         │ │
│  │  Example:                                               │ │
│  │  Agent calls: meta_search_posts_semantic("workout")   │ │
│  │      ↓                                                 │ │
│  │  Router finds: http://hybrid-api:3020/search_semantic │ │
│  │      ↓                                                 │ │
│  │  POST {query: "workout", limit: 10}                   │ │
│  │      ↓                                                 │ │
│  │  Response: [{post_id, caption, reach, ...}, ...]      │ │
│  │      ↓                                                 │ │
│  │  Return to agent                                       │ │
│  │                                                         │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### Tool Registration Flow

```
NEST STARTUP SEQUENCE:
━━━━━━━━━━━━━━━━━━━━━━

meta-nest container starts
    ↓
1. Run database migrations
    ↓
2. Start all services:
    ├─ sync-worker (background)
    ├─ enrichment-worker (background)
    ├─ MCP servers (ports 3004, 3005, 3007)
    └─ hybrid-search-api (port 3020)
    ↓
3. Wait for health checks (all services healthy)
    ↓
4. Build tool manifest:
    tools_manifest = {
      nest_id: "meta-content-nest",
      nest_version: "v2.3.1",
      health_endpoint: "http://meta-nest:3099/health",
      mcp_tools: [
        {
          id: "meta_get_current_follower_count",
          name: "Get Current Instagram Follower Count",
          description: "Fetch real-time follower count from Instagram API",
          category: "real-time",
          endpoint: "http://instagram-analytics-mcp:3005/get_follower_count",
          method: "POST",
          parameters: {
            type: "object",
            properties: {},
            required: []
          },
          cost: "1 API call",
          rate_limit: "200/hour"
        },
        ... (all MCP tools)
      ],
      hybrid_tools: [
        {
          id: "meta_search_posts_semantic",
          name: "Semantic Search Instagram Posts",
          description: "Search posts using AI embeddings for semantic understanding",
          category: "hybrid-search",
          endpoint: "http://hybrid-search-api:3020/search_semantic",
          method: "POST",
          parameters: {
            type: "object",
            properties: {
              query: {type: "string", description: "Search query"},
              limit: {type: "integer", default: 10}
            },
            required: ["query"]
          },
          cost: "free",
          response_time: "~50ms"
        },
        ... (all hybrid tools)
      ]
    }
    ↓
5. Register with aiviary-chat:
    POST http://aiviary-chat:4002/api/tools/register
    Body: tools_manifest
    ↓
6. aiviary-chat receives registration:
    ├─ Validate manifest schema
    ├─ Store in tool registry
    ├─ Update agent configuration
    ├─ Broadcast to UI: "Instagram tools available"
    └─ Return 200 OK
    ↓
7. meta-nest logs: "✅ Tools registered with aiviary-chat"
    ↓
8. Ready to serve tool calls


NEST SHUTDOWN SEQUENCE:
━━━━━━━━━━━━━━━━━━━━━━━

docker compose down meta-nest
    ↓
1. Catch SIGTERM signal
    ↓
2. Unregister tools:
    DELETE http://aiviary-chat:4002/api/tools/unregister/meta-content-nest
    ↓
3. aiviary-chat:
    ├─ Remove meta-nest from registry
    ├─ Update agent configuration (remove Instagram tools)
    └─ Broadcast to UI: "Instagram disconnected"
    ↓
4. Graceful shutdown (wait for in-progress tool calls to complete)
    ↓
5. Stop all services
```

---

## VI. Progressive Instruction Disclosure via Claude Skills

### The Mega Prompt Problem

**Challenge:** As nests are added to a client VM, the agent's system prompt grows exponentially with platform-specific instructions.

**Example - Current State (Without Skills):**

```
Meta-Nest Instructions (~1000 tokens):
- Database connection details
- 13 SQL helper function signatures
- Table schemas (instagram_posts, instagram_post_insights, etc.)
- Query patterns and examples
- Critical rules (always use client_id='client', date syntax, etc.)
- When to use helper functions vs custom SQL

YouTube-Nest Instructions (~1000 tokens):
- Database connection details
- 13 YouTube-specific SQL helper functions
- Table schemas (youtube_videos, youtube_video_insights, etc.)
- Query patterns for video analytics
- Quota management rules
- Subtitle extraction priorities

Asana-Nest Instructions (~500 tokens):
- MCP tool usage patterns
- Task management workflows
- API endpoint documentation

Google-Drive-Nest Instructions (~500 tokens):
- File search patterns
- Upload/download workflows
- Permission management

TOTAL SYSTEM PROMPT: 3000+ tokens (ALWAYS loaded)
```

**Problems:**

1. **Token Cost Explosion**
   - 3000 tokens × every user message
   - 80% of instructions irrelevant to each query
   - User asks about Instagram → still loads YouTube, Asana, Drive docs

2. **Agent Confusion**
   - Similar tools across platforms (get_top_posts vs get_top_videos)
   - Mixed metric names (reach vs views, saves vs watch_time)
   - Agent must remember which function belongs to which nest

3. **Maintenance Burden**
   - Update meta-nest instructions → must regenerate entire system prompt
   - No modular updates
   - Testing changes requires redeploying entire prompt

4. **Scalability Crisis**
   - Add 4 more nests → 6000+ token system prompt
   - Add 10 nests → 10,000+ token baseline (exceeds many model context windows)
   - Linear growth in token cost per message

### The Claude Skills Solution

**Concept:** Use Claude's built-in Skills system for progressive instruction disclosure.

**Skills = Markdown instruction documents that load on-demand**

Instead of front-loading all nest documentation, register each nest as a Claude Skill that activates only when needed.

**Key Insight:**
- Tools are already exposed (PostgreSQL access, MCP endpoints)
- The mega prompt problem is the **DOCUMENTATION** for using those tools
- Skills provide progressive disclosure of **instructions**, not tools themselves

**Token Savings Example:**

```
BEFORE (all-in-one system prompt):
Meta: 1000 tokens
YouTube: 1000 tokens
Asana: 500 tokens
Drive: 500 tokens
━━━━━━━━━━━━━━━━━
TOTAL: 3000 tokens (always loaded in every request)

AFTER (Skills):
System Prompt:
  Connected platforms: meta-sql-skill, youtube-sql-skill,
                      asana-api-skill, drive-api-skill
  To work with a platform, activate its skill.
━━━━━━━━━━━━━━━━━
TOTAL: 400 tokens (always loaded)

Active Context (when user asks about Instagram):
  System prompt: 400 tokens
  meta-sql-skill: 1000 tokens (loaded on-demand)
━━━━━━━━━━━━━━━━━
WORKING TOTAL: 1400 tokens

Unused skills: 0 tokens (never loaded)
YouTube, Asana, Drive docs remain dormant
```

**Savings:** 53% reduction in baseline prompt (3000 → 1400 tokens)

**Scalability:** Add 10 more nests → system prompt grows to ~1400 tokens (not 10,000)

---

### Skills Integration Architecture (Pattern 4)

**Pattern 4: Skill Bundled in Tool Registration**

Skills are included in the tool registration payload that nests already send on startup.

```
┌──────────────────────────────────────────────────────────────┐
│                    NEST STARTUP SEQUENCE                      │
│                  (Updated with Skills)                        │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  meta-nest container starts                                  │
│      ↓                                                        │
│  1. Run database migrations                                  │
│      ↓                                                        │
│  2. Start all services (sync, enrichment, MCP, hybrid)       │
│      ↓                                                        │
│  3. Wait for health checks                                   │
│      ↓                                                        │
│  4. Build registration payload:                              │
│     {                                                         │
│       nest_id: "meta-content-nest",                          │
│       nest_version: "v2.3.1",                                │
│       mcp_tools: [...],                                      │
│       hybrid_tools: [...],                                   │
│       skill: {                        ← NEW                  │
│         name: "meta-sql-skill",                              │
│         description: "Query Instagram & Meta Ads analytics", │
│         files: {                                             │
│           "SKILL.md": "# Instagram Analytics\n...",          │
│           "HELPER_FUNCTIONS.md": "## Functions\n...",        │
│           "SCHEMAS.md": "## Tables\n..."                     │
│         }                                                    │
│       }                                                      │
│     }                                                        │
│      ↓                                                        │
│  5. POST http://aiviary-chat:4002/api/tools/register         │
│      ↓                                                        │
│  6. aiviary-chat receives registration:                      │
│     ├─ Register tools in tool registry                       │
│     ├─ Write skill files to .claude/skills/meta-sql-skill/   │
│     ├─ Update agent system prompt (add skill metadata)       │
│     └─ Broadcast to UI: "Instagram connected"                │
│      ↓                                                        │
│  7. Ready to serve tool calls + skill activation             │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

**Skill Lifecycle:**

```
Nest Registration → Skill files written to .claude/skills/{skill_name}/
                  → Skill metadata added to system prompt

Skill Activation → User asks about Instagram
                → Agent activates meta-sql-skill
                → Skill instructions loaded into context
                → Agent uses instructions to query database

Nest Update     → New skill content in registration payload
                → aiviary-chat overwrites old skill files
                → Next activation uses updated instructions

Nest Shutdown   → DELETE /api/tools/unregister/{nest_id}
                → Skill files removed from .claude/skills/
                → Skill metadata removed from system prompt
```

---

### Nest-Side Skill Structure

**Each nest container includes a `/skills` directory:**

```
meta-nest/
├── sync-worker/
├── enrichment-worker/
├── mcp-servers/
├── hybrid-search-api/
└── skills/                    ← NEW
    ├── SKILL.md               (Main instructions, ~800 tokens)
    ├── HELPER_FUNCTIONS.md    (Function reference, ~500 tokens)
    ├── SCHEMAS.md             (Table schemas, ~400 tokens)
    └── EXAMPLES.md            (Query examples, ~300 tokens)
```

**SKILL.md Example (meta-sql-skill):**

```markdown
---
name: meta-sql-skill
description: Query Instagram & Meta Ads analytics from PostgreSQL
---

# Instagram & Meta Ads Analytics Database

Query Instagram posts, engagement metrics, follower growth, and ad campaigns.

## Database Connection

**REQUIRED for all queries:**
```
Host: postgres
Port: 5432
Database: analytics
User: postgres-non-root
Password: <from environment>
```

## Critical Rules

1. **ALWAYS** use `WHERE client_id = 'client'`
2. **PREFER helper functions** over custom SQL (95% token savings)
3. Use `CURRENT_DATE - 7` NOT `INTERVAL '7 days'` for date params
4. Default timeframe: 600 days when user doesn't specify

## Helper Functions by Category

**Performance:** get_top_posts_adaptive, get_total_reach_adaptive, compare_periods_adaptive
**Content:** analyze_content_types_adaptive, get_best_posting_times_adaptive
**Growth:** get_follower_growth_adaptive, get_audience_breakdown_adaptive
**Ad ROI:** get_ad_performance_summary_adaptive, calculate_cost_per_engagement_adaptive

[See HELPER_FUNCTIONS.md for complete signatures]

## Quick Start

```sql
-- Top posts this week
SELECT * FROM get_top_posts_adaptive('client', 'reach', 10, 7);

-- Follower growth this month
SELECT * FROM get_follower_growth_adaptive('client', CURRENT_DATE - 30, CURRENT_DATE);
```

## Main Tables

**instagram_posts:** id, caption, media_type, timestamp, likes_count, comments_count
**instagram_post_insights:** post_id, snapshot_date, views, reach, saved, total_interactions

[See SCHEMAS.md for complete table definitions]

## When to Use Custom SQL

Only when:
- User asks for specific caption/permalink
- Need to search caption text
- Helper functions don't cover the metric

[See EXAMPLES.md for correlation analysis, complex queries]
```

**Progressive Disclosure:**

- **SKILL.md** loads on activation (~800 tokens)
- **HELPER_FUNCTIONS.md** loads only if referenced (~500 tokens)
- **SCHEMAS.md** loads only if referenced (~400 tokens)
- **EXAMPLES.md** loads only if referenced (~300 tokens)

Agent starts with SKILL.md, loads supporting files as needed.

---

### aiviary-chat Skill Management

**New API Endpoints:**

```
POST /api/tools/register
Body: {
  nest_id: "meta-content-nest",
  mcp_tools: [...],
  hybrid_tools: [...],
  skill: {                    ← NEW field
    name: "meta-sql-skill",
    description: "Query Instagram & Meta Ads analytics",
    files: {
      "SKILL.md": "<markdown content>",
      "HELPER_FUNCTIONS.md": "<markdown content>",
      "SCHEMAS.md": "<markdown content>"
    }
  }
}

Response: {
  tools_registered: 18,
  skill_registered: "meta-sql-skill",
  skill_path: "/home/user/.claude/skills/meta-sql-skill"
}

DELETE /api/tools/unregister/{nest_id}
- Removes tools from registry
- Deletes skill files from .claude/skills/{skill_name}/
- Updates agent system prompt
```

**Skill Registration Handler:**

```javascript
// Pseudo-code for aiviary-chat skill registration

async function handleToolRegistration(payload) {
  // 1. Register tools (existing logic)
  await toolRegistry.register(payload.mcp_tools, payload.hybrid_tools);

  // 2. Register skill (NEW)
  if (payload.skill) {
    const skillPath = `/home/user/.claude/skills/${payload.skill.name}`;

    // Create skill directory
    await fs.mkdir(skillPath, { recursive: true });

    // Write skill files
    for (const [filename, content] of Object.entries(payload.skill.files)) {
      await fs.writeFile(`${skillPath}/${filename}`, content);
    }

    // Update agent system prompt
    await updateAgentPrompt({
      add_skill: {
        name: payload.skill.name,
        description: payload.skill.description
      }
    });

    logger.info(`Skill registered: ${payload.skill.name}`);
  }

  // 3. Broadcast update to UI
  await broadcast({
    type: 'nest_connected',
    nest_id: payload.nest_id,
    tools: payload.mcp_tools.length + payload.hybrid_tools.length,
    skill: payload.skill?.name
  });
}
```

---

### Updated Agent System Prompt

**New minimal system prompt (400 tokens):**

```
You help users analyze their social media performance across platforms.

CONNECTED PLATFORMS:

- meta-sql-skill: Query Instagram & Meta Ads analytics database
  Activate when: User asks about Instagram posts, engagement, followers, or ad campaigns

- youtube-sql-skill: Query YouTube video analytics database
  Activate when: User asks about videos, subscribers, watch time, or YouTube performance

- asana-api-skill: Task management via Asana API
  Activate when: User asks about tasks, projects, or wants to create/update tasks

- drive-api-skill: Google Drive file operations
  Activate when: User asks about files, wants to search Drive, or upload/download files

WORKFLOW:

1. Identify platform from user query (Instagram? YouTube? Asana?)
2. Activate corresponding skill (loads platform-specific instructions)
3. Use skill instructions to query data or call tools
4. Synthesize response for user

CROSS-PLATFORM QUERIES:

For questions spanning multiple platforms:
- Activate all relevant skills
- Query each platform separately
- Combine results in final response

Example: "Compare my Instagram vs YouTube engagement this month"
→ Activate meta-sql-skill + youtube-sql-skill
→ Query both databases
→ Present comparative analysis
```

**Token breakdown:**
- Platform metadata: 4 × 50 = 200 tokens
- Workflow guidance: 150 tokens
- Cross-platform instructions: 50 tokens
- **Total: 400 tokens** (regardless of nest count)

---

### Benefits of Skills Integration

**1. Token Efficiency**

- **Before:** 3000+ tokens per request (4 nests)
- **After:** 400 tokens baseline + ~1000 tokens for active skill
- **Savings:** 53% reduction in prompt tokens
- **Scales:** 10 nests = 1400 tokens (not 10,000)

**2. Agent Focus**

- Agent sees only relevant instructions for current task
- No confusion between similar cross-platform tools
- Clearer mental model of platform capabilities

**3. Modular Maintenance**

- Update meta-nest → only meta-sql-skill changes
- Test skill in isolation before deployment
- Version skills independently of other nests

**4. Progressive Disclosure**

- SKILL.md loads first (~800 tokens)
- Supporting files load only if needed
- Agent can reference HELPER_FUNCTIONS.md when uncertain

**5. Graceful Degradation**

- Skill registration fails → nest still registers tools
- Agent can call MCP/hybrid tools without skill guidance (less optimal but functional)
- Skill updates without downtime (overwrite files)

**6. Cross-Platform Intelligence**

- User: "Compare Instagram vs YouTube"
- Agent activates both meta-sql-skill + youtube-sql-skill
- Has full context for both platforms simultaneously
- Can synthesize meaningful comparisons

---

### Skill Naming Convention

**Pattern:** `{platform}-{type}-skill`

**Examples:**
- `meta-sql-skill` - PostgreSQL analytics queries for Instagram/Meta Ads
- `youtube-sql-skill` - PostgreSQL analytics queries for YouTube
- `asana-api-skill` - MCP tool usage for Asana task management
- `drive-api-skill` - MCP tool usage for Google Drive files
- `slack-api-skill` - MCP tool usage for Slack messaging

**Why this pattern:**
- Platform-first naming (user thinks in platforms)
- Type indicates primary interface (SQL vs API)
- Generic across all client VMs (not client-specific)

---

### Multi-Client Considerations

**Question:** Do all clients share the same skill content?

**Answer:** Yes - skills are generic instructions, not credentials.

**Example:**
- `client-a` with meta-nest: uses `meta-sql-skill`
- `client-b` with meta-nest: uses same `meta-sql-skill`
- `client-c` with meta-nest: uses same `meta-sql-skill`

**Why this works:**
- Database connection details come from environment variables (not hardcoded in skill)
- All clients use `client_id='client'` pattern (single-tenant per VM)
- SQL helper functions are identical across all meta-nest instances
- Skill teaches "how to query", not "what credentials to use"

**Client-specific customization:**
- Environment variables (DB passwords, connection strings)
- Not skill content itself

---

## VII. Deployment Mechanics for Stage 1

### Client Onboarding Script

**Interactive Deployment:**

```
./deploy-client.sh
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚀 Content Aiviary - Stage 1 Deployment

CLIENT CONFIGURATION
━━━━━━━━━━━━━━━━━━━━

Enter client ID (e.g., clienta): clienta
Enter domain (e.g., clienta.yourdomain.com): clienta.example.com

PLATFORM SELECTION
━━━━━━━━━━━━━━━━━━━━

Which platforms does this client need?

[✓] Meta (Instagram + Facebook Ads)
[ ] YouTube
[ ] Asana
[ ] Google Drive
[ ] Slack

Selected: Meta

INFRASTRUCTURE SIZING
━━━━━━━━━━━━━━━━━━━━

Estimated data volume:
- Instagram posts: ~500/month
- Meta ads: Active campaigns

Recommended: Medium (4 vCPU, 8GB RAM)

Continue? (y/n): y


DEPLOYMENT STEPS
━━━━━━━━━━━━━━━━━━━━

[1/8] Generating secrets...
      ✓ VM_API_KEY generated
      ✓ ENCRYPTION_KEY generated
      ✓ Database passwords generated

[2/8] Creating .env file...
      ✓ Configuration saved

[3/8] Registering client with nest-keeper...
      POST https://oauth.example.com/admin/clients
      ✓ Client registered (client_id: clienta)

[4/8] Starting core services...
      docker compose up -d credential-receiver
      docker compose up -d aiviary-chat
      docker compose up -d n8n
      docker compose up -d nginx
      ✓ Core services running

[5/8] Deploying Meta nest...
      docker compose --profile meta up -d
      ✓ meta-content-nest running
      ✓ Tools registered with aiviary-chat

[6/8] Running health checks...
      ✓ credential-receiver: healthy
      ✓ aiviary-chat: healthy
      ✓ n8n: healthy
      ✓ meta-nest: healthy

[7/8] Configuring Cloudflare tunnel...
      ✓ Tunnel created: clienta-tunnel
      ✓ DNS records configured

[8/8] Deployment complete!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ CLIENT READY

Onboarding Page:  https://clienta.example.com
Chat Interface:   https://chat.clienta.example.com
n8n Workflows:    http://clienta.example.com:5678 (Tailscale only)

NEXT STEPS:
1. Client visits onboarding page
2. Click "Connect Instagram"
3. Authorize via Meta OAuth
4. Wait for backfill (~30 minutes)
5. Start chatting with AI agent

CREDENTIALS (save securely):
VM_API_KEY:      b6c233ab7f...
ENCRYPTION_KEY:  074a06f460...
```

### Directory Structure on VM

```
/home/admin/content-aiviary/clienta/
├── .env                          # Client configuration
├── docker-compose.yml            # Master compose with profiles
├── data/                         # Persistent volumes
│   ├── credentials_db/           # OAuth tokens
│   ├── meta_db/                  # Instagram/Ads data
│   ├── youtube_db/               # (if deployed)
│   ├── n8n_db/                   # Workflow data
│   └── nginx/
│       ├── certs/                # SSL certificates
│       └── html/                 # Static onboarding page
├── logs/                         # Service logs
│   ├── credential-receiver.log
│   ├── meta-sync-worker.log
│   ├── meta-enrichment-worker.log
│   └── aiviary-chat.log
└── scripts/
    ├── deploy-client.sh          # Initial deployment
    ├── add-nest.sh               # Add new platform
    ├── remove-nest.sh            # Remove platform
    ├── backup.sh                 # Backup databases
    └── update-nest.sh            # Update specific nest
```

### Adding Platform After Deployment

```
./add-nest.sh
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📦 Add Platform to clienta

Available platforms:
1. YouTube
2. Asana
3. Google Drive
4. Slack
5. TikTok

Select platform (1-5): 1

DEPLOYING YOUTUBE NEST
━━━━━━━━━━━━━━━━━━━━

[1/4] Pulling youtube-nest:v1.0.5...
      ✓ Image downloaded

[2/4] Starting youtube-nest services...
      docker compose --profile youtube up -d
      ✓ youtube-sync-worker running
      ✓ youtube-enrichment-worker running
      ✓ youtube-analytics-mcp running
      ✓ youtube-hybrid-search-api running

[3/4] Running database migrations...
      ✓ youtube_db created
      ✓ Migrations applied

[4/4] Registering tools with aiviary-chat...
      ✓ YouTube tools available

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ YOUTUBE NEST DEPLOYED

Client can now:
1. Visit onboarding page
2. Click "Connect YouTube"
3. Authorize via Google OAuth
4. Wait for video backfill
5. Ask cross-platform questions

Total time: 2 minutes
```

### Updating a Nest

```
./update-nest.sh meta
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔄 Update meta-content-nest for clienta

Current version:  v2.3.1
Latest version:   v2.4.0

Changelog:
- Fixed pagination bug in ad insights sync
- Added support for Instagram Reels insights
- Performance improvements in enrichment

Continue? (y/n): y

[1/5] Pulling meta-nest:v2.4.0...
      ✓ Image downloaded

[2/5] Stopping meta-nest services...
      docker compose stop meta-nest
      ✓ Stopped

[3/5] Running database migrations...
      ✓ New migrations applied

[4/5] Starting meta-nest:v2.4.0...
      docker compose up -d meta-nest
      ✓ Started

[5/5] Health check...
      ✓ All services healthy
      ✓ Tools re-registered

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ UPDATE COMPLETE

meta-nest now running v2.4.0
Total downtime: ~30 seconds
```

---

## VII. Cost & Resource Planning

### Per-Client Resource Requirements

**Core Services (Always Running):**
- credential-receiver: 256 MB RAM, 0.1 vCPU
- aiviary-chat (OpenWebUI): 1 GB RAM, 0.5 vCPU
- n8n: 512 MB RAM, 0.25 vCPU
- nginx: 128 MB RAM, 0.1 vCPU
- **Total Core**: ~2 GB RAM, 1 vCPU

**Meta-Nest:**
- sync-worker: 512 MB RAM, 0.5 vCPU
- enrichment-worker: 2 GB RAM, 1 vCPU (AI processing)
- meta_db (PostgreSQL): 2 GB RAM, 0.5 vCPU
- MCP servers (3): 512 MB RAM total, 0.3 vCPU
- hybrid-search-api: 512 MB RAM, 0.25 vCPU
- **Total Meta**: ~5.5 GB RAM, 2.5 vCPU

**YouTube-Nest:**
- Similar to Meta-nest: ~5.5 GB RAM, 2.5 vCPU

**Asana-Nest:**
- n8n-importer: 128 MB RAM, 0.1 vCPU
- asana-mcp: 256 MB RAM, 0.1 vCPU
- **Total Asana**: ~384 MB RAM, 0.2 vCPU

### Recommended VM Sizing

**Starter (Meta only):**
- 8 GB RAM, 4 vCPU
- Cost: ~$40/month (DigitalOcean)
- Clients: Low post volume (<100/month)

**Professional (Meta + YouTube):**
- 16 GB RAM, 8 vCPU
- Cost: ~$80/month
- Clients: Medium volume (100-500 posts+videos/month)

**Enterprise (All platforms):**
- 32 GB RAM, 16 vCPU
- Cost: ~$160/month
- Clients: High volume (500+ content pieces/month)

### External API Costs (Per Client Per Month)

**Meta-Nest:**
- Meta Graph API: Free (within rate limits)
- Google Vertex AI embeddings: ~500 posts × $0.000025 = $0.0125
- Google Speech-to-Text: ~50 videos × 1 min × $0.016 = $0.80
- **Total Meta**: ~$0.82/month

**YouTube-Nest:**
- YouTube Data API: Free (within quota)
- Google Vertex AI: ~50 videos × $0.000025 = $0.00125
- Google Speech-to-Text: ~10 videos × 10 min × $0.016 = $1.60
- **Total YouTube**: ~$1.60/month

**Asana-Nest:**
- Asana API: Free (no rate limits for personal use)
- **Total Asana**: $0/month

**Note:** AI costs scale linearly with content volume.

---

## VIII. Monitoring & Health Checks

### Service Health Endpoints

**All services expose:**
```
GET /health
Response: {
  "status": "healthy",
  "service": "meta-sync-worker",
  "version": "v2.3.1",
  "uptime_seconds": 86400,
  "last_job_completed": "2025-01-06T14:30:00Z"
}
```

### aiviary-chat Dashboard

**Real-time status display:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTENT AIVIARY STATUS - clienta
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CONNECTED PLATFORMS:
✅ Instagram (meta-content-nest v2.3.1)
   Last sync: 2 hours ago
   Posts synced: 1,247
   Enrichment: 100% complete

✅ YouTube (youtube-content-nest v1.0.5)
   Last sync: 1 hour ago
   Videos synced: 83
   Enrichment: 100% complete

✅ Asana (asana-content-nest v1.2.0)
   Status: Connected
   Credentials valid

AVAILABLE TOOLS:
- 18 Instagram tools (3 real-time, 15 hybrid)
- 12 YouTube tools (2 real-time, 10 hybrid)
- 7 Asana tools (all real-time)

SYSTEM HEALTH:
✅ All services operational
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

This blueprint provides the complete Stage 1 architecture with clear integration patterns for YouTube and Asana nests. The key is maintaining independence while enabling seamless cross-platform intelligence through the agent.
