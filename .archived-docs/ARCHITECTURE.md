# Architecture Documentation

## System Overview

The Social Automation Platform uses a **centralized OAuth broker** pattern with **distributed client VMs** to provide multi-tenant social media intelligence services.

---

## Core Principles

### 1. **Complete Data Isolation**

Each client gets their own VM with:
- Dedicated database (NocoDB/PostgreSQL)
- Isolated n8n workflows
- Separate credential storage
- Independent scaling

**Why:** Security, compliance, and client trust

### 2. **Centralized OAuth**

Single Meta Developer App handles authentication for all clients:
- One app for all clients
- Simplified Meta app management
- Consistent permission scopes
- Centralized event logging

**Why:** Reduced Meta app review burden, easier management

### 3. **Token Distribution**

OAuth tokens are never stored centrally:
- Broker receives token → immediately forwards to client VM
- Client VM stores encrypted in its own database
- Broker only logs metadata (no sensitive data)

**Why:** Security best practice, minimal attack surface

---

## Component Architecture

### Central OAuth Broker

**Purpose:** Handle OAuth flows and route tokens to correct client VMs

**Technology:**
- Node.js (Express)
- PostgreSQL (client registry, event logs)
- Redis (future: caching, rate limiting)

**Database Tables:**
- `client_vm_registry` - Maps client_id → VM URL + API key
- `oauth_events` - Audit log of all OAuth flows
- `app_testers` - Track Meta app testers (Development Mode)

**API Endpoints:**
```
Public:
  GET  /auth/meta?client_id={id}   - Initiate OAuth
  GET  /callback                   - OAuth callback from Meta

Admin:
  GET    /admin/clients             - List clients
  POST   /admin/clients             - Register new client
  PUT    /admin/clients/:id         - Update client
  DELETE /admin/clients/:id         - Remove client
  GET    /admin/events              - View OAuth logs

Health:
  GET  /health                      - Health check
```

**OAuth Flow:**

```
1. Client visits: /auth/meta?client_id=clienta
2. Broker looks up clienta in registry
3. Broker redirects to Meta authorization
4. User authorizes, Meta redirects to /callback
5. Broker exchanges code for token
6. Broker fetches Instagram/Facebook/Ad account IDs
7. Broker POSTs credentials to clienta VM:
   POST https://clienta.com/api/credentials
   Headers: { X-API-Key: <vm_api_key> }
   Body: { access_token, instagram_id, ad_account_id, ... }
8. Client VM stores encrypted in NocoDB
9. Broker redirects user to clienta.com/success
```

**Security:**
- State parameter encrypted (prevents CSRF)
- VM API keys authenticate broker → VM communication
- TLS required for all external communication
- Event logging for audit trail

---

### Client VM (Per Client)

**Purpose:** Isolated environment for each client's data and workflows

**Technology:**
- n8n (workflow automation)
- NocoDB (database + API layer)
- PostgreSQL (data persistence)
- Redis (queue management)
- OpenWebUI (AI interface)
- Custom services (credential receiver, MCP servers)

**Key Services:**

#### 1. Credential Receiver (Port 3006)

**Purpose:** Receive and store OAuth credentials from central broker

**Endpoints:**
```
POST /api/credentials     - Receive from broker (authenticated)
GET  /api/credentials     - Provide to n8n/MCP (internal)
GET  /health              - Health check
```

**Security:**
- VM API key authentication
- AES-256 encryption for stored tokens
- No external exposure (internal network only)

**Storage:** NocoDB table `meta_credentials`
```
- client_id
- access_token (encrypted)
- token_expires_at
- instagram_business_account_id
- facebook_page_id
- ad_account_id
- meta_user_id
- created_at
- last_refreshed_at
```

#### 2. Meta Ads MCP (Port 3004) [TODO]

**Purpose:** HTTP wrapper for meta-ads-mcp package

**Features:**
- Campaign CRUD operations
- Ad creative management
- Performance insights
- Targeting configuration
- Budget management

**Integration:** n8n workflows call via HTTP

#### 3. Instagram Analytics MCP (Port 3005) [TODO]

**Purpose:** HTTP wrapper for instagram-analytics-mcp package

**Features:**
- Account insights (reach, impressions)
- Post performance metrics
- Follower demographics
- Story analytics
- Content recommendations

**Integration:** n8n workflows call via HTTP

#### 4. n8n Workflows

**Purpose:** Orchestrate data collection and AI processing

**Example Workflows:**
- Daily Instagram insights collection
- Hourly ad performance monitoring
- Competitor ad discovery
- AI content recommendation generation
- Client reporting

#### 5. NocoDB

**Purpose:** Structured data storage and API layer

**Tables:**
- `meta_credentials` - OAuth tokens
- `instagram_posts` - Post data
- `instagram_insights` - Performance metrics
- `ad_campaigns` - Campaign data
- `ad_insights` - Ad performance
- `competitor_ads` - Competitor intelligence
- `ai_recommendations` - Generated suggestions

#### 6. OpenWebUI

**Purpose:** Client-facing AI interface

**Features:**
- Chat with data
- Generate reports
- Ask questions about performance
- Get recommendations

---

## Data Flow

### OAuth Flow (Initial Setup)

```
Client Browser
    ↓
Central OAuth Broker
    ↓
Meta Authorization Server
    ↓
Central OAuth Broker (callback)
    ↓
Client VM (credential-receiver)
    ↓
NocoDB (encrypted storage)
```

### Data Collection Flow (Ongoing)

```
n8n Scheduled Trigger
    ↓
Fetch credentials from NocoDB
    ↓
Call Instagram MCP
    ↓
Instagram Graph API
    ↓
Parse response
    ↓
Store in NocoDB
    ↓
Trigger AI analysis (optional)
```

### AI Analysis Flow

```
n8n Workflow
    ↓
Fetch data from NocoDB
    ↓
Send to OpenAI/Claude API
    ↓
Generate insights/recommendations
    ↓
Store recommendations in NocoDB
    ↓
Send notification to client (email/Slack)
```

---

## Scaling Strategy

### Horizontal Scaling

**Client VMs:** One per client
- Deploy new VM for each new client
- Independent resource allocation
- Isolated failure domains

**Central Broker:** One instance (can be replicated)
- Stateless design (easy to replicate)
- PostgreSQL for state persistence
- Redis for session management (future)

### Vertical Scaling

**Per Client VM:**
- Adjust Docker resource limits
- Scale PostgreSQL/Redis instances
- Add worker nodes for n8n

**Central Broker:**
- Scale database connections
- Add API rate limiting
- Implement caching layer

---

## Security Model

### Layers of Security

1. **Network Layer**
   - TLS for all external communication
   - Private networks for VM internal communication
   - Firewall rules limiting exposure

2. **Authentication Layer**
   - OAuth 2.0 for Meta APIs
   - API keys for broker ↔ VM communication
   - NocoDB API tokens for data access

3. **Authorization Layer**
   - VM API keys are unique per client
   - Broker enforces client_id matching
   - n8n workflows scoped to client data

4. **Data Layer**
   - AES-256 encryption for tokens at rest
   - Encrypted database backups
   - No centralized token storage

5. **Audit Layer**
   - OAuth event logging
   - Access logs for all API calls
   - Client VM activity monitoring

---

## Failure Modes & Recovery

### Central Broker Failure

**Impact:** New OAuth flows fail, existing client VMs continue operating

**Recovery:**
- Restore from database backup
- Redeploy broker service
- Verify client registry intact

**Mitigation:**
- Regular database backups
- Health monitoring
- Failover instance (future)

### Client VM Failure

**Impact:** Single client affected, others unaffected

**Recovery:**
- Restore VM from backup
- Redeploy services
- Verify credentials intact
- Client may need to re-authorize if tokens lost

**Mitigation:**
- Regular VM backups
- Database replication
- Automated health checks

### Meta API Outage

**Impact:** Data collection fails, existing data remains accessible

**Recovery:**
- Wait for Meta API recovery
- Retry failed requests
- Backfill missing data

**Mitigation:**
- Implement exponential backoff
- Queue failed requests
- Alert on API errors

---

## Performance Considerations

### API Rate Limits

**Meta Graph API:**
- 200 requests/hour per user access token
- 200 requests/hour per app

**Mitigation:**
- Implement request queuing
- Batch API calls where possible
- Cache frequently accessed data

### Database Performance

**PostgreSQL:**
- Index on foreign keys
- Regular VACUUM operations
- Query optimization

**NocoDB:**
- Proper column types
- Minimal computed fields
- Pagination for large datasets

### n8n Workflow Performance

- Use webhooks vs polling where possible
- Implement workflow timeouts
- Separate heavy workflows to dedicated workers

---

## Monitoring & Observability

### Metrics to Track

**Central Broker:**
- OAuth success/failure rate
- Average OAuth completion time
- Client VM response times
- Database query performance

**Client VMs:**
- Workflow execution success rate
- API call latency
- Database size and growth
- Resource utilization (CPU, memory)

### Logging Strategy

**Centralized Logging:**
- Ship logs from all VMs to central log aggregation
- Use structured logging (JSON)
- Implement log retention policies

**Key Events to Log:**
- OAuth flows (success, failure, errors)
- API calls to Meta
- Workflow executions
- Client VM API requests
- Security events (auth failures)

---

## Development Mode vs Live Mode

### Development Mode (Current)

**Characteristics:**
- Up to 500 app testers
- Full API access
- No business verification required
- Clients must accept tester invitation

**Use For:**
- MVP development
- Beta testing
- Proof of concept
- First 50 clients

### Live Mode (Future)

**Characteristics:**
- Unlimited users
- Public app
- Requires business verification
- Requires Tech Provider status

**Use For:**
- Public launch
- Scaling beyond 500 clients
- Enterprise clients
- Production service

**Transition Path:**
1. Complete business verification
2. Apply for Tech Provider status
3. Submit app for review (if needed)
4. Switch app to Live Mode
5. No code changes required

---

## Technology Choices & Rationale

### Why Node.js for OAuth Broker?

- Fast for I/O-bound operations
- Mature OAuth libraries
- Easy to deploy
- Good async support

### Why n8n?

- Visual workflow builder (easier for non-developers)
- Extensive integrations
- Self-hosted (data control)
- Active community

### Why NocoDB?

- Spreadsheet-like interface (client-friendly)
- REST API auto-generation
- Self-hosted
- PostgreSQL backend

### Why MCP (Model Context Protocol)?

- Standard interface for AI tools
- Growing ecosystem
- Easy to wrap APIs
- Works with multiple AI platforms

---

## Future Enhancements

### Short-term (Next 3 months)

- Complete MCP server implementations
- Build n8n workflow library
- Create client onboarding automation
- Implement token refresh automation

### Medium-term (3-6 months)

- Automated VM provisioning
- Admin dashboard
- Billing integration
- Enhanced monitoring

### Long-term (6-12 months)

- Support for other social platforms (TikTok, LinkedIn)
- Advanced AI features
- White-label portal
- API for third-party integrations

---

## References

- [Meta Graph API Docs](https://developers.facebook.com/docs/graph-api)
- [OAuth 2.0 RFC](https://tools.ietf.org/html/rfc6749)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [n8n Documentation](https://docs.n8n.io)
- [NocoDB Documentation](https://docs.nocodb.com)
