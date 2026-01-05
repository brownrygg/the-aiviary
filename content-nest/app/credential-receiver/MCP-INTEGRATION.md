# MCP Server Integration with Credential Receiver

## Overview

MCP servers (Meta Ads MCP, Instagram Analytics MCP) fetch Meta API credentials directly from the credential-receiver service. This keeps tokens out of n8n workflows and centralizes credential management.

---

## API Endpoints

### 1. GET `/api/credentials` (Metadata Only)

**Purpose:** Get account IDs and metadata WITHOUT access token

**Use Case:** n8n workflows that need to know which accounts are connected

**Response:**
```json
{
  "client_id": "clienta",
  "instagram_business_account_id": "17841...",
  "facebook_page_id": "108154...",
  "ad_account_id": "act_123456789",
  "token_expires_at": "2025-03-01T00:00:00Z",
  "last_refreshed_at": "2025-01-15T10:30:00Z"
}
```

**Example n8n HTTP Request:**
```javascript
// HTTP Request Node
Method: GET
URL: http://credential-receiver:3006/api/credentials

// Use response in workflow
const igAccountId = $json.instagram_business_account_id;
```

---

### 2. GET `/api/credentials/token` (With Decrypted Token)

**Purpose:** Get full credentials INCLUDING decrypted access_token

**Use Case:** MCP servers calling Meta APIs

**⚠️ INTERNAL ONLY:** This endpoint should only be accessible to MCP servers on the internal Docker network

**Response:**
```json
{
  "client_id": "clienta",
  "access_token": "EAABwzLix...",
  "token_expires_at": "2025-03-01T00:00:00Z",
  "token_expired": false,
  "instagram_business_account_id": "17841...",
  "facebook_page_id": "108154...",
  "ad_account_id": "act_123456789",
  "meta_user_id": "12345678",
  "last_refreshed_at": "2025-01-15T10:30:00Z"
}
```

**Security Notes:**
- Returns `token_expired: true` if token has expired
- Logs every access for audit purposes
- Should NOT be exposed outside Docker network

---

## MCP Server Implementation Pattern

### Example: Meta Ads MCP Wrapper

```javascript
// meta-ads-mcp/mcp-http-wrapper.js

import axios from 'axios';

const CREDENTIAL_URL = process.env.CREDENTIAL_RECEIVER_URL || 'http://credential-receiver:3006';

// Fetch credentials (called internally by MCP)
async function getCredentials() {
  try {
    const response = await axios.get(`${CREDENTIAL_URL}/api/credentials/token`);

    if (response.data.token_expired) {
      throw new Error('Access token has expired. Client needs to re-authorize.');
    }

    return {
      accessToken: response.data.access_token,
      adAccountId: response.data.ad_account_id,
      instagramAccountId: response.data.instagram_business_account_id
    };
  } catch (err) {
    console.error('[Credential Fetch Error]', err.message);
    throw new Error('Failed to fetch credentials: ' + err.message);
  }
}

// HTTP endpoint for n8n to call
app.post('/mcp', async (req, res) => {
  const { method, params } = req.body;

  try {
    // Step 1: Fetch credentials internally
    const creds = await getCredentials();

    // Step 2: Call Meta Ads MCP with the token
    let result;

    switch (method) {
      case 'get_campaigns':
        result = await getCampaigns(creds.accessToken, creds.adAccountId, params);
        break;

      case 'get_ad_insights':
        result = await getAdInsights(creds.accessToken, params);
        break;

      case 'create_campaign':
        result = await createCampaign(creds.accessToken, creds.adAccountId, params);
        break;

      default:
        throw new Error(`Unknown method: ${method}`);
    }

    res.json({ success: true, data: result });

  } catch (err) {
    console.error('[MCP Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Example: Get campaigns from Meta API
async function getCampaigns(accessToken, adAccountId, params) {
  const response = await axios.get(
    `https://graph.facebook.com/v18.0/${adAccountId}/campaigns`,
    {
      params: {
        access_token: accessToken,
        fields: params.fields || 'id,name,status,objective',
        limit: params.limit || 25
      }
    }
  );

  return response.data;
}
```

---

## n8n Workflow Examples

### Example 1: Fetch Instagram Insights (Simple)

```
┌─────────────────────────────────┐
│ Schedule Trigger (Daily)        │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│ HTTP Request                    │
│ POST http://instagram-mcp:3005  │
│ Body: {                         │
│   "method": "get_account_insights"
│   "params": {                   │
│     "period": "day",            │
│     "metrics": [                │
│       "impressions",            │
│       "reach",                  │
│       "profile_views"           │
│     ]                           │
│   }                             │
│ }                               │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│ Store in NocoDB                 │
│ Table: instagram_insights       │
└─────────────────────────────────┘
```

**Key Point:** n8n doesn't need to fetch or handle the access token!

---

### Example 2: Fetch Ad Performance with Metadata

```
┌─────────────────────────────────┐
│ Schedule Trigger (Hourly)       │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│ HTTP Request #1                 │
│ GET http://credential-receiver:3006/api/credentials
│ Purpose: Get ad_account_id      │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│ Set Variable                    │
│ adAccountId = $json.ad_account_id
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│ HTTP Request #2                 │
│ POST http://meta-ads-mcp:3004   │
│ Body: {                         │
│   "method": "get_campaigns",    │
│   "params": {                   │
│     "fields": "name,status,spend"
│   }                             │
│ }                               │
│ Note: MCP fetches token internally
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│ Process Data                    │
│ Transform & analyze results     │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│ Store in NocoDB                 │
└─────────────────────────────────┘
```

---

## Security Best Practices

### ✅ DO:

- **MCP servers:** Call `/api/credentials/token` to get decrypted tokens
- **n8n workflows:** Call `/api/credentials` for metadata only
- **Keep tokens internal:** Never expose credential-receiver publicly
- **Use Docker network:** All credential fetching happens on internal network
- **Log access:** credential-receiver logs every token access

### ❌ DON'T:

- Don't expose `/api/credentials/token` outside Docker network
- Don't pass tokens through n8n workflows (except for advanced use cases)
- Don't store tokens in n8n variables or credentials
- Don't call Meta APIs directly from n8n (use MCP instead)

---

## Token Expiry Handling

### Current Behavior

When token is expired:

```javascript
// MCP server gets response:
{
  "token_expired": true,
  "access_token": "...",  // Still returned but expired
  "token_expires_at": "2025-01-01T00:00:00Z"
}
```

MCP should:
1. Check `token_expired` flag
2. Return error to n8n with message: "Token expired, client needs to re-authorize"
3. n8n workflow can send notification to client

### Future: Automatic Token Refresh

TODO: Implement automatic token refresh:
1. credential-receiver checks expiry before returning
2. If < 7 days remaining, refresh token automatically
3. Store new token in NocoDB
4. Return fresh token to MCP

---

## Testing

### Test Metadata Endpoint (No Token)

```bash
curl http://localhost:3006/api/credentials
```

Expected response:
```json
{
  "client_id": "test-client-a",
  "instagram_business_account_id": "17841...",
  "facebook_page_id": "108154...",
  "ad_account_id": "act_123456",
  "token_expires_at": "2025-03-01T00:00:00Z",
  "last_refreshed_at": "2025-01-15T10:30:00Z"
}
```

### Test Token Endpoint (With Decrypted Token)

```bash
curl http://localhost:3006/api/credentials/token
```

Expected response:
```json
{
  "client_id": "test-client-a",
  "access_token": "EAABwzLix...",
  "token_expired": false,
  "instagram_business_account_id": "17841...",
  "facebook_page_id": "108154...",
  "ad_account_id": "act_123456",
  "meta_user_id": "12345678",
  "token_expires_at": "2025-03-01T00:00:00Z",
  "last_refreshed_at": "2025-01-15T10:30:00Z"
}
```

### Check Logs

```bash
docker compose logs -f credential-receiver
```

Should see:
```
[Token Access] Provided decrypted token for client: test-client-a
```

---

## Summary

**Data Flow:**

```
n8n Workflow
    │
    ├─> [Metadata needed?]
    │   └─> GET /api/credentials (no token)
    │
    └─> [Call MCP server]
        └─> POST http://meta-ads-mcp:3004/mcp
              └─> MCP internally:
                  └─> GET /api/credentials/token
                      └─> Call Meta API with token
                          └─> Return data to n8n
```

**Key Benefits:**

✅ Tokens never exposed in n8n workflows
✅ Centralized credential management
✅ MCP servers are self-contained
✅ Easy token refresh implementation (future)
✅ Audit logging of all token access
✅ Automatic expiry detection
