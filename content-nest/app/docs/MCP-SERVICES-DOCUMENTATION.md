# MCP Services Documentation

## Overview

This stack includes three MCP (Model Context Protocol) services that provide AI agents with access to Meta/Instagram APIs:

1. **Meta Ads MCP** (port 3004) - Ad campaign management and performance
2. **Instagram Analytics MCP** (port 3005) - Instagram business account data
3. **Meta Ad Library MCP** (port 3007) - Competitor ad intelligence

All services run as Docker containers and expose HTTP endpoints for n8n integration.

---

## Architecture

```
n8n Workflow
    ↓ HTTP Request
MCP Service (HTTP wrapper)
    ↓ stdio/JSON-RPC
MCP Server (Meta Graph API)
    ↓ OAuth credentials
credential-receiver
    ↓ encrypted storage
NocoDB
```

**Important:** These MCP services are NOT connected directly to OpenWebUI. They are ONLY accessible from n8n workflows.

---

## Service Endpoints

### Common Endpoints (All Services)

Each MCP service exposes the following HTTP endpoints:

#### 1. Health Check
```http
GET http://{service}:{port}/health
```

**Response:**
```json
{
  "status": "ok",
  "service": "service-name",
  "mcpReady": true,
  "pendingRequests": 0
}
```

#### 2. List Available Tools
```http
GET http://{service}:{port}/tools
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 123,
  "result": {
    "tools": [
      {
        "name": "tool_name",
        "description": "Tool description",
        "inputSchema": { ... }
      }
    ]
  }
}
```

#### 3. Call a Tool (Convenience Endpoint)
```http
POST http://{service}:{port}/call
Content-Type: application/json

{
  "tool": "tool_name",
  "arguments": {
    "param1": "value1",
    "param2": "value2"
  }
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 123,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{...json data...}"
      }
    ]
  }
}
```

#### 4. Full JSON-RPC Endpoint
```http
POST http://{service}:{port}/mcp
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "tool_name",
    "arguments": {
      "param1": "value1"
    }
  }
}
```

---

## 1. Meta Ads MCP

**Container:** `meta-ads-mcp`
**Port:** 3004
**Internal URL:** `http://meta-ads-mcp:3004`
**External URL:** `http://localhost:3004`

### Available Tools

#### `get_campaigns`
Get ad campaigns from your Meta Ads account.

**Parameters:**
```json
{
  "status": "ACTIVE",      // Optional: ACTIVE, PAUSED, ARCHIVED, ALL
  "limit": 25              // Optional: 1-100, default 25
}
```

**Example Request:**
```bash
curl -X POST http://localhost:3004/call \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "get_campaigns",
    "arguments": {
      "status": "ACTIVE",
      "limit": 10
    }
  }'
```

---

#### `get_campaign_insights`
Get performance metrics for a specific campaign.

**Parameters:**
```json
{
  "campaign_id": "123456789",              // Required
  "date_preset": "last_7d",                // Optional: today, yesterday, last_7d, last_30d, lifetime
  "metrics": "spend,impressions,clicks"    // Optional: comma-separated
}
```

**Example Request:**
```bash
curl -X POST http://localhost:3004/call \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "get_campaign_insights",
    "arguments": {
      "campaign_id": "123456789",
      "date_preset": "last_7d"
    }
  }'
```

---

#### `get_adsets`
Get ad sets for a campaign.

**Parameters:**
```json
{
  "campaign_id": "123456789",  // Required
  "status": "ACTIVE",          // Optional: ACTIVE, PAUSED, ALL
  "limit": 25                  // Optional: 1-100
}
```

---

#### `get_ads`
Get individual ads for an ad set.

**Parameters:**
```json
{
  "adset_id": "123456789",  // Required
  "status": "ACTIVE",       // Optional: ACTIVE, PAUSED, ALL
  "limit": 25               // Optional: 1-100
}
```

---

#### `get_ad_insights`
Get performance metrics for a specific ad.

**Parameters:**
```json
{
  "ad_id": "123456789",                 // Required
  "date_preset": "last_7d",             // Optional
  "metrics": "spend,impressions,ctr"    // Optional
}
```

---

#### `get_account_insights`
Get overall ad account performance.

**Parameters:**
```json
{
  "date_preset": "last_30d",            // Optional
  "metrics": "spend,impressions,roas"   // Optional
}
```

---

## 2. Instagram Analytics MCP

**Container:** `instagram-analytics-mcp`
**Port:** 3005
**Internal URL:** `http://instagram-analytics-mcp:3005`
**External URL:** `http://localhost:3005`

### Available Tools

#### `get_media`
Get recent Instagram posts from your business account.

**Parameters:**
```json
{
  "limit": 25,                    // Optional: 1-100, default 25
  "since": "2025-01-01T00:00:00Z" // Optional: ISO date
}
```

**Example Request:**
```bash
curl -X POST http://localhost:3005/call \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "get_media",
    "arguments": {
      "limit": 10
    }
  }'
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 123,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"data\":[{\"id\":\"123\",\"caption\":\"Post caption\",\"media_type\":\"IMAGE\",\"timestamp\":\"2025-12-30T10:00:00+0000\"}]}"
      }
    ]
  }
}
```

---

#### `get_media_insights`
Get detailed performance insights for a specific post.

**Parameters:**
```json
{
  "media_id": "123456789",                                    // Required
  "metrics": "impressions,reach,engagement,saved,comments"    // Optional
}
```

---

#### `get_profile_insights`
Get account-level Instagram insights.

**Parameters:**
```json
{
  "period": "day",                            // Optional: day, week, days_28, lifetime
  "metrics": "impressions,reach,profile_views" // Optional
}
```

---

#### `get_audience_demographics`
Get follower demographics.

**Parameters:**
```json
{
  "breakdown": "age"  // Optional: age, gender, city, country
}
```

**Example Response:**
```json
{
  "data": [
    {
      "name": "follower_demographics",
      "values": [
        {
          "value": {
            "18-24": 150,
            "25-34": 320,
            "35-44": 180
          }
        }
      ]
    }
  ]
}
```

---

#### `get_media_with_insights`
Get recent posts WITH their insights in one call (most efficient).

**Parameters:**
```json
{
  "limit": 10  // Optional: 1-25, default 10
}
```

---

## 3. Meta Ad Library MCP

**Container:** `meta-ad-library-mcp`
**Port:** 3007
**Internal URL:** `http://meta-ad-library-mcp:3007`
**External URL:** `http://localhost:3007`

**⚠️ Important:** Requires Identity Verification at https://facebook.com/id

### Available Tools

#### `search_ads`
Search Meta Ad Library for ads by keyword.

**Parameters:**
```json
{
  "search_terms": "fitness supplements",  // Required
  "country": "US",                        // Optional: country code
  "status": "ALL",                        // Optional: ALL, ACTIVE, INACTIVE
  "limit": 25                             // Optional: 1-100
}
```

**Example Request:**
```bash
curl -X POST http://localhost:3007/call \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "search_ads",
    "arguments": {
      "search_terms": "project management software",
      "status": "ACTIVE",
      "limit": 10
    }
  }'
```

---

#### `get_advertiser_ads`
Get all ads from a specific advertiser/competitor.

**Parameters:**
```json
{
  "advertiser_name": "Nike",  // Required
  "status": "ACTIVE",         // Optional: ACTIVE, ALL
  "country": "US",            // Optional
  "limit": 25                 // Optional
}
```

---

#### `analyze_ad_longevity`
Analyze how long ads have been running (90+ days = likely profitable).

**Parameters:**
```json
{
  "advertiser_name": "Competitor Inc",  // Required
  "min_days_active": 30,                // Optional: default 30
  "country": "US"                       // Optional
}
```

**Example Response:**
```json
{
  "total_active_ads": 45,
  "long_running_ads": 12,
  "min_days_filter": 30,
  "ads": [
    {
      "id": "123456",
      "ad_creative_bodies": ["Ad text here"],
      "ad_delivery_start_time": "2024-06-01T00:00:00+0000",
      "days_active": 212,
      "page_name": "Competitor Inc"
    }
  ]
}
```

---

#### `get_trending_creatives`
Discover trending ad formats in an industry.

**Parameters:**
```json
{
  "industry_keywords": "SaaS project management",  // Required
  "country": "US",                                 // Optional
  "limit": 50                                      // Optional: default 50
}
```

**Example Response:**
```json
{
  "total_ads_analyzed": 50,
  "platform_distribution": {
    "facebook": 35,
    "instagram": 42,
    "messenger": 8
  },
  "top_advertisers": [
    {
      "advertiser": "Asana",
      "ad_count": 8
    },
    {
      "advertiser": "Monday.com",
      "ad_count": 6
    }
  ],
  "sample_ads": [...]
}
```

---

## n8n Integration Guide

### Method 1: HTTP Request Node (Recommended)

1. **Add HTTP Request node** to your workflow
2. **Configure the request:**

**Settings:**
```
Method: POST
URL: http://instagram-analytics-mcp:3005/call
Authentication: None (services are on same Docker network)
```

**Headers:**
```
Content-Type: application/json
```

**Body (JSON):**
```json
{
  "tool": "get_media",
  "arguments": {
    "limit": 10
  }
}
```

3. **Parse the response:**

Add a **Code node** after the HTTP Request:

```javascript
// Extract the tool result from JSON-RPC response
const response = $input.item.json;

// The actual data is in result.content[0].text
const resultText = response.result.content[0].text;

// Parse the JSON string
const data = JSON.parse(resultText);

return {
  json: data
};
```

---

### Method 2: Multiple Tools in Sequence

**Example Workflow:** Get Instagram posts and their insights

**Node 1:** HTTP Request - Get Media
```json
{
  "tool": "get_media_with_insights",
  "arguments": {
    "limit": 5
  }
}
```

**Node 2:** Code - Parse Response
```javascript
const response = $input.item.json;
const posts = JSON.parse(response.result.content[0].text);

// Return each post as separate item for processing
return posts.data.map(post => ({
  json: {
    id: post.id,
    caption: post.caption,
    impressions: post.insights?.impressions || 0,
    engagement: post.insights?.engagement || 0
  }
}));
```

**Node 3:** AI Agent - Analyze Performance
```
Analyze this Instagram post:
Caption: {{$json.caption}}
Impressions: {{$json.impressions}}
Engagement: {{$json.engagement}}

Provide recommendations for improvement.
```

---

### Method 3: Using JSON-RPC Endpoint

For more control, use the `/mcp` endpoint:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_campaigns",
    "arguments": {
      "status": "ACTIVE",
      "limit": 10
    }
  }
}
```

---

## Example n8n Workflows

### Workflow 1: Daily Instagram Performance Report

```
1. Schedule Trigger (daily at 9am)
   ↓
2. HTTP Request → get_media_with_insights (limit: 7)
   ↓
3. Code → Parse and aggregate metrics
   ↓
4. AI Agent → Analyze trends and create summary
   ↓
5. Send Email → Daily report to client
```

### Workflow 2: Ad Campaign Optimizer

```
1. Schedule Trigger (every 6 hours)
   ↓
2. HTTP Request → get_campaigns (status: ACTIVE)
   ↓
3. Loop through campaigns
   ↓
4. HTTP Request → get_campaign_insights (last_7d)
   ↓
5. AI Agent → Analyze ROAS and recommend actions
   ↓
6. Slack Notification → If ROAS < 2.0, alert team
```

### Workflow 3: Competitor Intelligence

```
1. Manual Trigger
   ↓
2. HTTP Request → search_ads (competitor keyword)
   ↓
3. HTTP Request → analyze_ad_longevity (min 90 days)
   ↓
4. AI Agent → Identify patterns in winning ads
   ↓
5. Save to NocoDB → Store insights for client dashboard
```

---

## Error Handling

### Common Errors

#### 1. "No credentials found"
```json
{
  "error": "No credentials found"
}
```
**Solution:** User needs to complete OAuth flow to connect their Meta/Instagram account.

---

#### 2. "Failed to decrypt access token"
```json
{
  "error": "Failed to decrypt access token"
}
```
**Solution:** Encryption key mismatch. Check `ENCRYPTION_KEY` in `.env` matches across all services.

---

#### 3. "ACTION REQUIRED: Meta Ad Library Access Not Enabled"
```
⛔ ACTION REQUIRED: Meta Ad Library Access Not Enabled

To use the Ad Library search feature, you must complete Identity Verification with Meta.
```
**Solution:** User must verify their identity at https://facebook.com/id, then reconnect their account.

---

#### 4. Request Timeout
```json
{
  "error": "Request timeout"
}
```
**Solution:** Known issue with HTTP wrapper. Use `/mcp` JSON-RPC endpoint instead of `/call`, or test from n8n (may work better than curl).

---

## Testing

### Quick Test Commands

**Test Meta Ads MCP:**
```bash
curl -X POST http://localhost:3004/call \
  -H "Content-Type: application/json" \
  -d '{"tool":"get_account_insights","arguments":{"date_preset":"last_7d"}}'
```

**Test Instagram Analytics MCP:**
```bash
curl -X POST http://localhost:3005/call \
  -H "Content-Type: application/json" \
  -d '{"tool":"get_media","arguments":{"limit":5}}'
```

**Test Meta Ad Library MCP:**
```bash
curl -X POST http://localhost:3007/call \
  -H "Content-Type: application/json" \
  -d '{"tool":"search_ads","arguments":{"search_terms":"test","limit":1}}'
```

---

## Container Management

### Check Service Status
```bash
docker ps | grep -E "meta-ads-mcp|instagram-analytics-mcp|meta-ad-library-mcp"
```

### View Logs
```bash
docker logs instagram-analytics-mcp
docker logs meta-ads-mcp
docker logs meta-ad-library-mcp
```

### Restart Services
```bash
docker compose restart instagram-analytics-mcp
docker compose restart meta-ads-mcp
docker compose restart meta-ad-library-mcp
```

### Rebuild After Code Changes
```bash
docker compose build meta-ads-mcp
docker compose up -d meta-ads-mcp
```

---

## Security Notes

1. **No public exposure:** MCP services are only accessible within Docker network
2. **Credential isolation:** Each client VM has isolated credentials in NocoDB
3. **Encrypted storage:** Access tokens encrypted with AES-256-CBC
4. **No API keys in requests:** Credentials fetched automatically from credential-receiver

---

## Next Steps

1. **Create your first n8n workflow** using the examples above
2. **Test with real credentials** by completing OAuth flow
3. **Build AI agents** that use these tools to provide insights
4. **Monitor usage** via Docker logs and n8n execution history

For questions or issues, check the troubleshooting section or run:
```bash
./test-ad-library-verification.sh
```
