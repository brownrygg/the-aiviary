# Credentials Flow - How Everything Works Together

## The Problem We Solved

**Initial Issue:** n8n workflows need Meta API access tokens to call MCP servers, but storing/passing tokens through workflows is insecure and messy.

**Solution:** MCP servers fetch credentials themselves from the aiviary-connect service.

---

## Complete Data Flow

### 1. OAuth & Initial Storage

```
Client authorizes via Meta
         ↓
Central OAuth Broker receives token
         ↓
POST https://clienta.com/api/credentials
{
  "access_token": "EAABwzLix...",
  "instagram_business_account_id": "...",
  "ad_account_id": "...",
  ...
}
         ↓
Aiviary Connect (port 3006)
  - Encrypts access_token (AES-256)
  - Stores in NocoDB table: meta_credentials
         ↓
Credentials stored securely ✅
```

---

### 2. n8n Workflow Execution (Daily Instagram Insights)

```
┌──────────────────────────────────────────────────────────┐
│ n8n Workflow: "Fetch Daily Instagram Insights"          │
└──────────────────────────────────────────────────────────┘

Step 1: Schedule Trigger (runs daily at 9 AM)
         ↓

Step 2: HTTP Request to Instagram MCP
   POST http://instagram-mcp:3005/mcp
   Body: {
     "method": "get_account_insights",
     "params": {
       "period": "day",
       "metrics": ["impressions", "reach", "profile_views"]
     }
   }

   ⚠️ Note: n8n does NOT fetch or pass any access token!

         ↓

Step 3: Instagram MCP server receives request
   Internal flow:

   a) Fetch credentials from aiviary-connect:
      GET http://aiviary-connect:3006/api/credentials/token

      Response: {
        "access_token": "EAABwzLix...",  (decrypted)
        "instagram_business_account_id": "17841...",
        "token_expired": false
      }

   b) Call Instagram Graph API:
      GET https://graph.facebook.com/v18.0/17841.../insights
      Headers: { Authorization: "Bearer EAABwzLix..." }

   c) Parse response and return to n8n:
      {
        "impressions": 12543,
        "reach": 8921,
        "profile_views": 342
      }

         ↓

Step 4: n8n receives clean data (no tokens!)
         ↓

Step 5: Store in NocoDB
   Table: instagram_insights
   Columns: date, impressions, reach, profile_views
```

---

## API Endpoints Reference

### Credential Receiver (Port 3006)

#### 1. POST `/api/credentials`
**Purpose:** Receive OAuth tokens from central broker
**Auth:** VM API Key (X-API-Key header)
**Called by:** Central OAuth Broker
**Stores:** Encrypted credentials in NocoDB

---

#### 2. GET `/api/credentials`
**Purpose:** Get account metadata WITHOUT token
**Auth:** None (internal network)
**Called by:** n8n workflows (when they need account IDs)
**Returns:**
```json
{
  "client_id": "clienta",
  "instagram_business_account_id": "17841...",
  "facebook_page_id": "108154...",
  "ad_account_id": "act_123456",
  "token_expires_at": "2025-03-01T00:00:00Z"
}
```

---

#### 3. GET `/api/credentials/token` ⭐ **KEY ENDPOINT**
**Purpose:** Get full credentials WITH decrypted access token
**Auth:** None (internal network only - never expose publicly!)
**Called by:** MCP servers ONLY
**Returns:**
```json
{
  "client_id": "clienta",
  "access_token": "EAABwzLix...",  ← Decrypted token
  "token_expired": false,
  "instagram_business_account_id": "17841...",
  "facebook_page_id": "108154...",
  "ad_account_id": "act_123456",
  "meta_user_id": "12345678",
  "token_expires_at": "2025-03-01T00:00:00Z"
}
```

**Security:**
- Logs every access for audit
- Returns `token_expired: true` if expired
- Should NEVER be exposed outside Docker network

---

## MCP Server Pattern

All MCP servers follow this pattern:

```javascript
// Example: meta-ads-mcp/server.js

async function getAccessToken() {
  const response = await axios.get(
    'http://aiviary-connect:3006/api/credentials/token'
  );

  if (response.data.token_expired) {
    throw new Error('Token expired - client needs to re-authorize');
  }

  return response.data.access_token;
}

// HTTP endpoint for n8n
app.post('/mcp', async (req, res) => {
  const { method, params } = req.body;

  // Fetch token internally (n8n doesn't provide it)
  const accessToken = await getAccessToken();

  // Use token to call Meta API
  const result = await callMetaAPI(accessToken, method, params);

  res.json(result);
});
```

---

## Security Model

### Layers of Protection

**Layer 1: Encryption at Rest**
- Tokens encrypted with AES-256 in NocoDB
- ENCRYPTION_KEY stored in .env (never committed)

**Layer 2: Network Isolation**
- aiviary-connect only accessible on Docker internal network
- No public exposure of `/api/credentials/token`
- MCP servers also internal-only

**Layer 3: Access Logging**
- Every token fetch is logged
- Audit trail for compliance
- Expiry detection

**Layer 4: Minimal Exposure**
- n8n workflows never see raw tokens
- Tokens only exist in MCP server memory (briefly)
- No token storage in n8n variables

---

## What This Enables

### For n8n Workflows:

✅ **Simple API calls** - just call MCP methods, no token management
✅ **No credential storage** - n8n doesn't store any sensitive data
✅ **Automatic token handling** - MCP handles expiry, refresh, etc
✅ **Clean code** - workflows focus on business logic

### For MCP Servers:

✅ **Self-contained** - fetch their own credentials
✅ **Token abstraction** - hide complexity from workflows
✅ **Future-proof** - easy to add token refresh logic
✅ **Secure** - tokens stay in server memory only

### For Security:

✅ **Encrypted storage** - tokens encrypted at rest
✅ **Audit logging** - every access is logged
✅ **Network isolation** - internal Docker network only
✅ **Expiry detection** - automatic warnings on expiry

---

## Example: Full End-to-End Flow

**Scenario:** Client wants daily Instagram post performance report

### Setup (One-time):

1. Client completes OAuth → credentials stored encrypted
2. Deploy Instagram MCP server (port 3005)
3. Create n8n workflow

### Daily Execution:

```
09:00 AM - Trigger fires
   ↓
09:00:01 - n8n calls Instagram MCP
   POST http://instagram-mcp:3005/mcp
   { "method": "get_recent_media" }
   ↓
09:00:02 - Instagram MCP fetches token
   GET http://aiviary-connect:3006/api/credentials/token
   ↓
09:00:03 - Instagram MCP calls Meta API
   GET https://graph.facebook.com/v18.0/.../media
   Headers: { Authorization: "Bearer [token]" }
   ↓
09:00:04 - Instagram MCP returns data to n8n
   { "media": [...posts...] }
   ↓
09:00:05 - n8n stores in NocoDB
   Table: instagram_posts
   ↓
09:00:06 - n8n calls AI for analysis
   OpenAI: "Analyze engagement patterns..."
   ↓
09:00:07 - n8n sends report email
   Subject: "Your Daily Instagram Performance"
   Body: "Top posts: ..."
```

**Total time:** ~7 seconds
**Token exposures:** 0 (only in MCP server memory)
**n8n complexity:** Minimal (just HTTP requests)

---

## Testing Checklist

### ✅ Test 1: Metadata Endpoint

```bash
curl http://localhost:3006/api/credentials
```

Should return account IDs (no token)

---

### ✅ Test 2: Token Endpoint

```bash
curl http://localhost:3006/api/credentials/token
```

Should return:
- Decrypted access_token
- token_expired: false
- All account IDs

---

### ✅ Test 3: Verify Encryption

```bash
# Check NocoDB directly
# access_token column should show encrypted format:
# "abc123...:def456..."  (iv:encrypted_data)
```

---

### ✅ Test 4: Check Logs

```bash
docker compose logs -f aiviary-connect
```

Should see:
```
[Token Access] Provided decrypted token for client: test-client-a
```

---

### ✅ Test 5: Expiry Detection

Temporarily set token_expires_at to past date in NocoDB, then:

```bash
curl http://localhost:3006/api/credentials/token
```

Should return:
```json
{
  "token_expired": true,
  ...
}
```

And logs should show:
```
[Token Expired] Token expired at 2024-01-01T00:00:00Z
```

---

## Summary

**The credential flow is now:**

1. ✅ OAuth completes → encrypted storage
2. ✅ n8n calls MCP (no tokens)
3. ✅ MCP fetches token internally
4. ✅ MCP calls Meta API
5. ✅ MCP returns clean data to n8n
6. ✅ n8n processes & stores

**Security:**
- Tokens encrypted at rest
- Never exposed in n8n
- Network isolated
- Audit logged

**Developer Experience:**
- n8n workflows stay simple
- MCP servers self-contained
- Easy to test and debug

🎉 **Problem solved!**
