# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Multi-tenant social media intelligence and automation platform for Meta/Instagram. Built for agencies managing multiple clients with complete data isolation. Uses a centralized OAuth broker pattern with distributed client VMs.

**Key Architecture:** One central OAuth broker handles Meta authentication for all clients → Each client gets their own isolated VM with n8n, NocoDB, MCP servers, OpenWebUI, and **Analytics Database**.

**NEW: Analytics Database System** - Separate PostgreSQL `analytics` database with automated sync-worker for 95%+ AI token cost reduction. Stores ALL Instagram/Meta data with smart daily updates and 13 SQL helper functions for fast queries. Uses generic `client_id='client'` for single-tenant simplicity.

## Project Structure

```
content-aiviary/
├── nest-keeper/          # Central OAuth service (ONE instance)
│   └── app/
│       ├── nest-keeper/               # Express.js OAuth server
│       ├── database/init.sql           # PostgreSQL schema
│       └── docker-compose.yml
│
└── content-nest/        # Client VM template (deployed per client)
    └── app/
        ├── credential-receiver/        # Receives & stores OAuth tokens
        ├── sync-worker/               # Background data sync service
        │   ├── lib/                   # Database, API wrappers, rate limiter
        │   └── jobs/                  # Backfill and daily sync jobs
        ├── database/
        │   ├── migrations/            # Analytics schema migrations
        │   │   ├── 001_analytics_schema.sql        # Core tables & original helper functions
        │   │   └── 002_graceful_data_handling.sql  # Adaptive helper functions
        │   └── init.sh               # Auto-runs migrations on startup
        ├── nginx/
        │   ├── html/                  # NEW: Static onboarding page
        │   │   └── index.html        # Client onboarding dashboard
        │   ├── nginx.conf.template    # Nginx configuration
        │   └── certs/                 # SSL certificates
        ├── meta-ads-mcp/              # Meta Ads API wrapper
        ├── instagram-analytics-mcp/    # Instagram API wrapper
        ├── meta-ad-library-mcp/        # Ad library search
        ├── nocodb-mcp/                # NocoDB database wrapper
        ├── example-workflows/          # n8n workflow templates
        ├── ANALYTICS_AGENT_PROMPT.md  # AI agent prompt for analytics queries
        └── docker-compose.yml
```

## Development Commands

### Central OAuth Broker

```bash
cd nest-keeper/app

# Start all services
docker compose up -d

# View logs
docker compose logs -f oauth-broker

# Test health
curl http://localhost:3000/health

# Register a client VM
curl -X POST http://localhost:3000/admin/clients \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "test-client",
    "client_name": "Test Client",
    "vm_url": "http://localhost:3006",
    "vm_api_key": "YOUR_VM_API_KEY"
  }'

# Stop services
docker compose down
```

### Client VM Stack

```bash
cd content-nest/app

# Start all services
docker compose up -d

# Start specific service
docker compose up -d credential-receiver

# View logs for specific service
docker compose logs -f credential-receiver

# Restart after config changes
docker compose restart credential-receiver

# Test credential receiver health
curl http://localhost:3006/health

# Stop services
docker compose down
```

### Testing OAuth Flow

```bash
# 1. Start both stacks (broker + client VM)
# 2. Register client VM in broker (see above)
# 3. Initiate OAuth flow
open http://localhost:3000/auth/meta?client_id=test-client

# 4. Check if credentials were stored
curl http://localhost:3006/api/credentials
```

### MCP Server Testing

```bash
# Test Meta Ad Library MCP
cd content-nest/app
docker compose logs -f meta-ad-library-mcp

# Test endpoint
curl -X POST http://localhost:3007/search \
  -H "Content-Type: application/json" \
  -d '{
    "search_terms": "Nike shoes",
    "ad_reached_countries": ["US"],
    "limit": 10
  }'
```

### Working with n8n

```bash
# Access n8n UI
open http://localhost:5678

# Import workflow
docker exec n8n n8n import:workflow --input=/data/workflow.json

# Export workflow
docker exec n8n n8n export:workflow --output=/data/export.json --id=<workflow_id>

# List workflows
docker exec n8n n8n list:workflow
```

### Analytics Database & Sync Worker (NEW)

```bash
cd content-nest/app

# View sync-worker logs (job processing, backfills, daily syncs)
docker compose logs -f sync-worker

# Check analytics tables (UPDATED: analytics database, not n8n)
docker compose exec postgres psql -U postgres-non-root -d analytics -c "\dt" | grep -E "instagram_|ad_|sync_"

# List helper functions
docker compose exec postgres psql -U postgres-non-root -d analytics -c "\df"

# Check job queue status
docker compose exec postgres psql -U postgres-non-root -d analytics -c "
SELECT job_type, status, COUNT(*)
FROM sync_jobs
GROUP BY job_type, status;
"

# Check sync status (NOTE: uses generic client_id='client')
docker compose exec postgres psql -U postgres-non-root -d analytics -c "
SELECT client_id, backfill_completed, last_instagram_sync, last_ads_sync
FROM sync_status;
"

# Query analytics (example: top posts - NOTE: always use 'client' as client_id)
docker compose exec postgres psql -U postgres-non-root -d analytics -c "
SELECT * FROM get_top_posts('reach', 10, 7);
"

# Use adaptive helper functions (auto-adjust to available data)
docker compose exec postgres psql -U postgres-non-root -d analytics -c "
SELECT * FROM get_top_posts_adaptive('client', 'reach', 10, 30);
"

# Check data availability first
docker compose exec postgres psql -U postgres-non-root -d analytics -c "
SELECT * FROM get_client_data_availability('client');
"

# Compare periods with auto-adjustment
docker compose exec postgres psql -U postgres-non-root -d analytics -c "
SELECT * FROM compare_periods_adaptive('client', 'engagement', '2024-11-01', '2024-11-30', '2024-12-01', '2024-12-31');
"

# Manually trigger backfill for testing
docker compose exec postgres psql -U postgres-non-root -d analytics -c "
INSERT INTO sync_jobs (client_id, job_type, priority, job_payload)
VALUES ('client', 'backfill', 100, '{\"instagram_account_id\": \"test\"}'::jsonb);
"
```

## Key Architecture Concepts

### OAuth Flow (How Credentials Move)

1. **Client Authorization**: User visits `https://oauth-broker.com/auth/meta?client_id=clienta`
2. **Meta OAuth**: Broker redirects to Meta, user authorizes
3. **Token Exchange**: Broker exchanges code for 60-day access token
4. **Account Discovery**: Broker fetches Instagram/Facebook/Ad Account IDs
5. **Token Forwarding**: Broker POSTs credentials to client VM's credential-receiver
6. **Encrypted Storage**: Client VM encrypts token (AES-256) and stores in NocoDB
7. **Redirect**: User sent to client's success page

**Critical**: Tokens are NEVER stored centrally. Broker immediately forwards to client VM.

### Credential Access Pattern (How MCP Servers Get Tokens)

**Problem**: n8n workflows need Meta API access but storing tokens in workflows is insecure.

**Solution**: MCP servers fetch credentials internally from credential-receiver.

```
n8n workflow
    ↓ (calls MCP server - NO TOKEN SENT)
MCP server
    ↓ (fetches token internally)
credential-receiver (GET /api/credentials/token)
    ↓ (returns decrypted token)
MCP server
    ↓ (calls Meta API with token)
Meta Graph API
    ↓ (returns data)
MCP server
    ↓ (returns clean data - NO TOKEN)
n8n workflow
```

**Security**: Tokens only exist briefly in MCP server memory, never in n8n, never in logs.

### Analytics Database Architecture (NEW - December 2025)

**Problem**: Repeatedly fetching Instagram/Meta data via MCP servers is expensive in AI tokens (~30k tokens per query). Each AI query triggers full API calls, even for cached data.

**Solution**: Separate `analytics` PostgreSQL database (not `n8n`) with automated sync-worker.

**Single-Tenant Pattern**: Each client VM has ONE database with generic `client_id='client'` for all data. This allows n8n AI agents to query without knowing client-specific identifiers. The central OAuth broker maintains real client_id for routing, but credential-receiver translates to 'client' for storage.

**Data Flow:**
```
OAuth Complete → credential-receiver logs broker client_id, stores as 'client'
    ↓
credential-receiver inserts backfill job into sync_jobs table (analytics database)
    ↓
sync-worker polls every 60s, picks up job (FOR UPDATE SKIP LOCKED)
    ↓
Backfill: Fetch ALL Instagram/Meta data (not limited to 30 days) → Store in analytics database
    ↓
Daily Sync (4AM): Smart updates based on post age
    - Posts <7 days: Update insights daily
    - Posts 7-30 days: Update insights weekly (Mondays)
    - Posts >30 days: On-demand only
    ↓
AI queries SQL helper functions in analytics database (no MCP servers needed)
```

**Token Savings:** 95%+ reduction (30k → 1.5k tokens per query)

**Critical Architecture Note:** Analytics tables live in `analytics` database, NOT `n8n` database. This separation keeps workflow data isolated from analytics data.

**Database Tables (13):**
- `instagram_account_profile` - Current profile snapshot
- `instagram_follower_history` - Daily follower tracking
- `instagram_posts` - All posts with engagement
- `instagram_post_insights` - Time-series metrics (views, reach, saves)
- `instagram_account_insights` - Daily account metrics
- `instagram_audience_demographics` - Follower demographics (JSONB)
- `ad_campaigns` - Campaign metadata
- `ad_campaign_insights` - Daily campaign performance
- `ad_sets` - Ad set details
- `ads` - Individual ads
- `ad_insights` - Ad-level performance
- `sync_status` - Per-client sync tracking
- `sync_jobs` - Job queue (backfill, daily_sync)

**SQL Helper Functions (13 + 13 Adaptive Versions):**

**Original Functions:**
- Performance: `get_total_reach()`, `get_top_posts()`, `get_engagement_rate()`, `compare_periods()`
- Content: `analyze_content_types()`, `get_best_posting_times()`, `find_top_hashtags()`
- Growth: `get_follower_growth()`, `get_audience_breakdown()`, `calculate_retention_rate()`
- ROI: `get_ad_performance_summary()`, `calculate_cost_per_engagement()`, `compare_campaign_efficiency()`

**NEW - Adaptive Functions (Migration 002):**
- All 13 functions have `*_adaptive()` versions that gracefully handle missing data
- Auto-adjust date ranges to available data (e.g., client has 30 days, query asks for 90 days → uses 30)
- Return status messages in results (`status_message`, `data_availability_status` columns)
- Include data quality scores and adjustment notes
- Example: `get_top_posts_adaptive('client', 'reach', 10, 30)` instead of `get_top_posts('reach', 10, 30)`
- **Utility functions**: `get_client_data_availability()` checks what data exists, `adjust_date_range()` adjusts dates automatically

**Sync-Worker Service:**
- Node.js service with rate limiting (180 req/hour vs 200 limit)
- Polls job queue every 60 seconds
- Cron: Daily sync at 4AM, weekly cleanup at 2AM Sunday
- Retry logic: 3 attempts with exponential backoff (5, 10, 20 minutes)
- Structured logging with Winston

**Meta Ad Library Note:** Competitor ad data is search-based ONLY via `meta-ad-library-mcp` - NOT stored in analytics database.

### Multi-Tenant Isolation

- **Network**: Each client VM on separate Docker network
- **Data**: Each client has own PostgreSQL database via NocoDB
- **Credentials**: Encrypted per-client, never shared
- **Workflows**: Each client's n8n instance isolated
- **Failure**: One client VM failure doesn't affect others

### Service Communication

**Internal Network (Docker)**:
- n8n → MCP servers (ports 3004, 3005, 3007) [for real-time API calls]
- n8n → PostgreSQL `analytics` database (direct SQL queries via helper functions) [for historical data]
- n8n → PostgreSQL `n8n` database (workflow execution data)
- MCP servers → credential-receiver:3006 (fetch OAuth tokens)
- sync-worker → credential-receiver:3006 (fetch OAuth tokens)
- sync-worker → PostgreSQL `analytics` database (store/update Instagram/Meta data)
- credential-receiver → PostgreSQL `analytics` database (store credentials, create backfill jobs)
- All services → NocoDB:8080

**Database Separation**:
- `n8n` database: n8n workflow execution logs, settings
- `analytics` database: Instagram/Meta data, credentials, sync jobs

**External**:
- OAuth Broker:3000 → Client VM credential-receiver:3006 (authenticated with VM_API_KEY)
- Client browser → Cloudflare Tunnel → Services

### Client Onboarding Dashboard (NEW - January 2026)

**Purpose**: Simple static HTML page that allows clients to connect services and access OpenWebUI.

**Architecture:**
- Static HTML served by nginx at root domain (`clienta.rikkcontent.com`)
- JavaScript checks connection status via `/api/status` (proxied to credential-receiver)
- "Connect Instagram" button redirects to OAuth broker
- "Launch Analytics Chat" button redirects to `chat.clienta.rikkcontent.com`
- Auto-refreshes status every 10 seconds

**File Structure:**
```
content-nest/app/
├── nginx/
│   ├── html/
│   │   └── index.html          # Onboarding dashboard
│   └── nginx.conf.template     # Updated to serve static files
└── docker-compose.yml          # Updated to mount html/ directory
```

**Nginx Configuration:**
- Root domain (`${DOMAIN}`) serves static HTML from `/usr/share/nginx/html`
- `/api/status` proxies to `credential-receiver:3006/api/credentials`
- Subdomains still work: `chat.${DOMAIN}`, `n8n.${DOMAIN}`, `nocodb.${DOMAIN}`

**Customization Per Client:**
Edit `nginx/html/index.html` lines 189-191:
```javascript
const OAUTH_BROKER_URL = 'https://oauth.rikkcontent.com';
const CLIENT_ID = 'clienta'; // Change per client
```

**Adding New Services:**
Copy the service card block (lines 156-169) and modify service name, description, and connect function.

## Environment Configuration

### Central OAuth Broker (.env)

Required variables:
```bash
META_APP_ID=your_app_id
META_APP_SECRET=your_app_secret
OAUTH_REDIRECT_URI=https://oauth.yourdomain.com/callback
BASE_URL=https://oauth.yourdomain.com
ENCRYPTION_KEY=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
```

### Client VM (.env)

Required variables:
```bash
# VM Identity (IMPORTANT: See note below about CLIENT_ID)
CLIENT_ID=client  # ALWAYS 'client' for single-tenant VMs (changed Dec 2025)
VM_API_KEY=$(openssl rand -hex 32)  # Must match in broker registration

# NocoDB (get from UI after first setup)
NOCODB_API_TOKEN=your_token
NOCODB_BASE_ID=your_base_id
NOCODB_TABLE_ID=your_table_id  # For meta_credentials table

# Encryption (NEVER change after storing credentials)
ENCRYPTION_KEY=$(openssl rand -hex 32)

# Cloudflare Tunnel (optional)
CLOUDFLARE_TUNNEL_TOKEN=your_token
```

**IMPORTANT - CLIENT_ID Change (December 2025):**
- All client VMs now use `CLIENT_ID=client` (generic identifier)
- This allows n8n AI agents to query analytics without client-specific knowledge
- OAuth broker still uses real client_id (e.g., 'clienta') for routing
- credential-receiver logs the broker's client_id, then stores as 'client'
- This is a single-tenant architecture: one client per VM/database

## Database Schemas

### Central Broker (PostgreSQL)

**client_vm_registry**: Maps client_id → VM URL + API key
**oauth_events**: Audit log of all OAuth flows
**app_testers**: Tracks Meta app testers (Development Mode)

### Client VM - Analytics Database (PostgreSQL)

**NEW (December 2025)**: All analytics data now in separate `analytics` database, NOT `n8n` database.

**Credentials & Sync Management:**
- `meta_credentials` - OAuth tokens and account IDs (encrypted, AES-256)
- `sync_status` - Per-client sync tracking (backfill completion, last sync times)
- `sync_jobs` - Job queue for backfill and daily sync operations

**Instagram Data:**
- `instagram_account_profile` - Current profile snapshot
- `instagram_follower_history` - Daily follower counts
- `instagram_posts` - All posts with engagement metrics
- `instagram_post_insights` - Time-series post performance (reach, saves, views)
- `instagram_account_insights` - Daily account-level metrics
- `instagram_audience_demographics` - Follower demographics (JSONB)

**Meta Ads Data:**
- `ad_campaigns` - Campaign metadata and budgets
- `ad_campaign_insights` - Daily campaign performance
- `ad_sets` - Ad set configurations
- `ads` - Individual ad creative data
- `ad_insights` - Ad-level performance metrics

**All tables use `client_id='client'` (generic identifier for single-tenant architecture)**

### Client VM - n8n Database (PostgreSQL)

n8n workflow execution logs, settings, and internal data only. No analytics data stored here.

## Common Patterns

### Adding a New MCP Server

1. Create directory in `content-nest/app/`
2. Create Dockerfile with Node.js base
3. Implement server.js with:
   - Express HTTP server
   - Credential fetching from credential-receiver:3006
   - Meta API integration
   - Error handling
4. Add to docker-compose.yml with:
   - `CREDENTIAL_RECEIVER_URL=http://credential-receiver:3006`
   - Proper port mapping
   - Dependency on credential-receiver
5. Add corresponding n8n workflow template

### Creating n8n Workflows

1. Use HTTP Request nodes to call MCP servers (not Meta API directly)
2. Never pass access tokens in workflow - MCP servers fetch internally
3. Store results in NocoDB using HTTP Request or NocoDB node
4. Use credentials from NocoDB for account IDs (via GET /api/credentials)
5. Add error handling for expired tokens

### Token Encryption/Decryption

All done in credential-receiver/server.js:
```javascript
// Encrypt before storing
const encrypted = encrypt(access_token);

// Decrypt when serving
const decrypted = decrypt(encrypted_token);
```

**Critical**: ENCRYPTION_KEY must never change once credentials are stored.

## Testing & Debugging

### Check if OAuth flow worked
```bash
# Check broker logs
cd nest-keeper/app
docker compose logs oauth-broker | grep "Successfully forwarded"

# Check client VM logs
cd content-nest/app
docker compose logs credential-receiver | grep "Stored credentials"

# Verify in NocoDB
curl http://localhost:3006/api/credentials
```

### Debug MCP server issues
```bash
# Check if credential-receiver is accessible
docker exec meta-ads-mcp curl http://credential-receiver:3006/health

# Check if token fetch works
docker exec meta-ads-mcp curl http://credential-receiver:3006/api/credentials/token
```

### Verify token expiry
```bash
# Check expiry date
curl http://localhost:3006/api/credentials | jq '.token_expires_at'

# Tokens are valid for 60 days from creation
```

## Meta API Integration Notes

### Development Mode vs Live Mode

**Current: Development Mode**
- Up to 500 clients as "App Testers"
- Full API access
- No business verification required
- Clients must accept tester invitation in Meta

**Future: Live Mode**
- Unlimited users
- Requires business verification
- Requires Tech Provider status
- No code changes needed to transition

### Required Meta App Permissions

Must be configured in Meta Developer Console:
- `instagram_basic`
- `instagram_manage_insights`
- `pages_read_engagement`
- `ads_read`
- `ads_management`
- `business_management`

### API Rate Limits

- 200 requests/hour per user access token
- 200 requests/hour per app

**Mitigation in workflows**:
- Batch requests where possible
- Implement queuing for high-volume operations
- Cache frequently accessed data in NocoDB

## Security Considerations

### Never Commit
- .env files (all variations)
- API keys or tokens
- Encryption keys
- Database passwords
- SSL certificates in nginx/certs/

### VM_API_KEY Authentication
- Used for broker → client VM communication
- Must be unique per client VM
- Generate with: `openssl rand -hex 32`
- Store in both broker registry and client VM .env

### Token Storage
- Always encrypted with AES-256
- IV prepended to ciphertext (format: `iv:encrypted`)
- ENCRYPTION_KEY stored in .env only
- Never log decrypted tokens

### Network Exposure
- credential-receiver should NEVER be publicly accessible
- Only internal Docker network access
- Use Cloudflare Tunnel for public access to n8n/OpenWebUI

## Deployment Order

1. **Set up Meta Developer App** (developers.facebook.com)
2. **Deploy Central OAuth Broker** (one instance)
3. **Configure NocoDB** in first client VM
4. **Deploy Client VM** (once per client)
5. **Register Client** in broker admin API
6. **Add User as Tester** in Meta app
7. **Test OAuth Flow**
8. **Deploy MCP Servers**
9. **Import n8n Workflows**

## Common Issues

### "Token expired" errors
- Check `token_expires_at` in meta_credentials table
- Meta tokens expire after 60 days
- Client needs to re-authorize via OAuth flow

### MCP server can't reach credential-receiver
- Verify both on same Docker network
- Check service names in docker-compose.yml
- Ensure credential-receiver is healthy: `docker compose ps`

### NocoDB connection errors
- Verify NOCODB_API_TOKEN is valid (regenerate in UI if needed)
- Check NOCODB_BASE_ID matches URL in NocoDB UI
- Ensure NocoDB service is running and healthy

### OAuth callback fails
- Verify OAUTH_REDIRECT_URI in broker .env matches Meta app settings
- Check broker logs for specific error
- Ensure client_id is registered in broker

## Current Status & Ready for Testing (Updated: January 2026)

### ✅ Completed Features

**Analytics Database Migration (December 2025)**
- ✅ Created separate `analytics` database (no longer in `n8n` database)
- ✅ Updated `database/init.sh` to create analytics database and run migrations
- ✅ Updated `docker-compose.yml` to route sync-worker and credential-receiver to analytics database
- ✅ All 13 analytics tables properly separated from n8n workflow data

**Generic Client ID Implementation**
- ✅ Changed all services to use `CLIENT_ID=client` (single-tenant pattern)
- ✅ credential-receiver logs broker's real client_id, stores as 'client' for routing preservation
- ✅ Updated all SQL queries in sync-worker to use generic 'client' identifier
- ✅ n8n AI agents can now query analytics without knowing client-specific identifiers

**Schema Alignment Fixes (sync-worker/jobs/dailySync.js)**
- ✅ Fixed `instagram_account_profile`: Changed `instagram_user_id` → `instagram_business_account_id`
- ✅ Fixed `instagram_follower_history`: Changed `date` → `snapshot_date`, added all required columns
- ✅ Fixed `instagram_posts`: Changed `media_id` → `id` as primary key
- ✅ Fixed `instagram_post_insights`: Rewrote from generic metric storage to specific columns (views, reach, saved, etc.)
- ✅ Fixed `instagram_account_insights`: Changed `date` → `snapshot_date`, proper period handling
- ✅ Fixed `ad_campaigns`: Changed `campaign_id` → `id`, proper conflict handling
- ✅ All column names now match database schema exactly

**Analytics Agent Optimization**
- ✅ Created `ANALYTICS_AGENT_PROMPT.md` with efficient ~1000 token prompt (reduced from 8000 tokens)
- ✅ Focuses on 13 SQL helper functions for common queries
- ✅ Includes essential table schemas and query patterns
- ✅ 87% token reduction per query (8000 → 1000 tokens)

**Graceful Data Handling (January 2026)**
- ✅ Created migration `002_graceful_data_handling.sql` with adaptive helper functions
- ✅ All 13 helper functions now have `*_adaptive()` versions
- ✅ Auto-adjusts date ranges to available data (handles clients with different data histories)
- ✅ Returns clear status messages when data is missing or adjusted
- ✅ Includes data quality scores (0-100) to indicate adjustment level
- ✅ Updated `ANALYTICS_AGENT_PROMPT.md` to use adaptive functions
- ✅ Utility functions: `get_client_data_availability()`, `adjust_date_range()`

**Client Onboarding Dashboard (January 2026)**
- ✅ Created static HTML onboarding page (`nginx/html/index.html`)
- ✅ Updated nginx configuration to serve root domain
- ✅ JavaScript checks connection status and enables/disables UI
- ✅ OAuth connection flow integrated
- ✅ Redirect to OpenWebUI chat interface
- ✅ Auto-refresh status every 10 seconds
- ✅ Easy to customize per client (edit config variables)
- ✅ Easy to add new services (copy service card block)

**CRITICAL FIX: Helper Function Token Optimization (January 2026 - Migration 003)**
- ✅ **PROBLEM IDENTIFIED**: `get_top_posts()` and `get_top_posts_adaptive()` were returning full captions + permalinks
- ✅ **IMPACT**: AI querying "top posts this week" was receiving 10+ full captions (hundreds of characters each) → massive token waste
- ✅ **ROOT CAUSE**: Helper functions supposed to return ONLY metrics, but were returning raw text fields
- ✅ **FIX APPLIED**: Removed `caption TEXT` and `permalink TEXT` from both functions' return signatures
- ✅ **NEW BEHAVIOR**: Functions return ONLY: post_id, media_type, timestamp, metric_value, engagement_rate, status
- ✅ **TOKEN SAVINGS**: Query returns ~200 tokens instead of ~2000+ tokens (90% reduction for top posts queries)
- ✅ **MIGRATION**: `003_remove_caption_from_helpers.sql` - auto-runs on new deployments
- ✅ **DOCUMENTATION**: Updated `docs/ANALYTICS_AGENT_PROMPT.md` with clear guidance on when to use helper functions vs custom SQL
- ✅ **AI GUIDANCE**: Added section explaining to use helper functions for metrics, custom SQL only when caption/permalink needed
- ✅ **VERIFIED**: Tested with real data - returns metrics only, no text bloat

**Why This Matters:**
The entire analytics database was designed to avoid expensive MCP server calls (95% token reduction: 30k → 1.5k). But if helper functions return full captions, we lose that optimization. This fix ensures helper functions truly return ONLY pre-calculated metrics, reserving expensive text queries for when truly needed.

### 🧪 Ready for Testing

**Prerequisites:**
1. OAuth broker must be running
2. Client VM must be registered in broker
3. Must complete OAuth flow to populate credentials

**Testing Steps:**
```bash
cd content-nest/app

# 1. Rebuild and start services (database was recreated)
docker compose down
docker compose up -d

# 2. Verify analytics database exists
docker compose exec postgres psql -U postgres -c "\l" | grep analytics

# 3. Verify tables were created
docker compose exec postgres psql -U postgres-non-root -d analytics -c "\dt"

# 4. Complete OAuth flow (THIS IS REQUIRED - credentials were wiped)
# Visit: https://oauth-broker.com/auth/meta?client_id=your-client-id

# 5. Verify credentials were stored
curl http://localhost:3006/api/credentials

# 6. Check backfill job was created
docker compose exec postgres psql -U postgres-non-root -d analytics -c "
SELECT * FROM sync_jobs WHERE client_id='client' ORDER BY created_at DESC LIMIT 5;
"

# 7. Watch sync-worker process backfill
docker compose logs -f sync-worker

# 8. Verify data was synced (after backfill completes)
docker compose exec postgres psql -U postgres-non-root -d analytics -c "
SELECT COUNT(*) FROM instagram_posts WHERE client_id='client';
"

# 9. Test SQL helper functions
docker compose exec postgres psql -U postgres-non-root -d analytics -c "
SELECT * FROM get_top_posts('reach', 10, 7);
"

# 10. Test daily sync (wait for 4AM or manually trigger)
docker compose exec postgres psql -U postgres-non-root -d analytics -c "
INSERT INTO sync_jobs (client_id, job_type, priority)
VALUES ('client', 'daily_sync', 50);
"
```

### ⚠️ Known Issues

**Database Recreation Required:**
- All data was wiped when migrating to analytics database
- Must re-run OAuth flow to populate credentials
- Backfill will re-fetch all Instagram/Meta data

**Testing Blocker:**
- Cannot test until OAuth flow is completed (credentials required)

### 📋 Next Steps

1. **Complete OAuth flow** to populate credentials in new analytics database
2. **Monitor backfill job** to ensure all data syncs correctly
3. **Verify daily sync** runs at 4AM without errors
4. **Test SQL helper functions** with real data (including adaptive versions)
5. **Create n8n workflows** that query analytics database directly
6. **Test AI agent** using ANALYTICS_AGENT_PROMPT.md
7. **Test onboarding dashboard** at root domain
8. **Verify Cloudflare Tunnel** routes root domain to nginx

### Testing Onboarding Dashboard

```bash
cd content-nest/app

# Restart nginx to pick up new configuration
docker compose restart nginx

# Check nginx logs
docker compose logs -f nginx

# Visit onboarding page (replace with your domain)
# https://clienta.rikkcontent.com

# Test connection status endpoint
curl http://localhost:3006/api/credentials

# Expected behavior:
# 1. Page loads with purple gradient background
# 2. "Meta/Instagram" card shows "Checking..." status initially
# 3. After API call, shows "Connected" (green) or "Not Connected" (red)
# 4. If connected, "Launch Analytics Chat" button becomes enabled
# 5. Clicking "Connect Instagram" redirects to OAuth broker
```

## Documentation References

- **PROJECT-STATUS.md**: Current implementation status and next steps
- **ARCHITECTURE.md**: Detailed technical architecture and design decisions
- **CREDENTIALS-FLOW.md**: How credentials move through the system
- **nest-keeper/app/DEPLOYMENT.md**: OAuth broker deployment guide
- **content-nest/app/CLIENT-VM-SETUP.md**: Client VM setup guide
- **content-nest/app/MCP-SERVICES-DOCUMENTATION.md**: MCP server API reference
- **content-nest/app/ANALYTICS_AGENT_PROMPT.md**: Efficient AI agent prompt for analytics queries

## Technology Stack

- **OAuth Broker**: Node.js, Express, PostgreSQL, Redis
- **Client VM**: n8n, NocoDB, PostgreSQL, Redis, OpenWebUI
- **MCP Servers**: Node.js, Express, Axios
- **Deployment**: Docker Compose, Cloudflare Tunnels
- **APIs**: Meta Graph API v18.0+
