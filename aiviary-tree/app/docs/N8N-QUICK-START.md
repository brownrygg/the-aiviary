# n8n MCP Integration - Quick Start Guide

## 🚀 5-Minute Setup

### Step 1: Add HTTP Request Node

In your n8n workflow, add an **HTTP Request** node.

### Step 2: Configure the Request

**For Instagram Analytics:**
```
Method: POST
URL: http://instagram-analytics-mcp:3005/call
```

**For Meta Ads:**
```
Method: POST
URL: http://meta-ads-mcp:3004/call
```

**For Ad Library:**
```
Method: POST
URL: http://meta-ad-library-mcp:3007/call
```

### Step 3: Set Headers

Add header:
```
Content-Type: application/json
```

### Step 4: Add Request Body

Click **Body** → **JSON** and paste:

```json
{
  "tool": "get_media",
  "arguments": {
    "limit": 10
  }
}
```

### Step 5: Parse Response

Add a **Code** node after the HTTP Request:

```javascript
// Parse MCP response
const response = $input.item.json;
const data = JSON.parse(response.result.content[0].text);
return { json: data };
```

---

## 📋 Tool Reference Card

### Instagram Analytics (Port 3005)

| Tool | What It Does | Key Parameters |
|------|-------------|----------------|
| `get_media` | Get recent posts | `limit` (1-100) |
| `get_media_insights` | Post performance | `media_id`, `metrics` |
| `get_media_with_insights` | Posts + metrics (efficient!) | `limit` (1-25) |
| `get_profile_insights` | Account metrics | `period`, `metrics` |
| `get_audience_demographics` | Follower breakdown | `breakdown` (age/gender/city) |

### Meta Ads (Port 3004)

| Tool | What It Does | Key Parameters |
|------|-------------|----------------|
| `get_campaigns` | List campaigns | `status`, `limit` |
| `get_campaign_insights` | Campaign performance | `campaign_id`, `date_preset` |
| `get_adsets` | Ad sets for campaign | `campaign_id`, `status` |
| `get_ads` | Ads for ad set | `adset_id`, `status` |
| `get_ad_insights` | Ad performance | `ad_id`, `date_preset` |
| `get_account_insights` | Overall account metrics | `date_preset`, `metrics` |

### Meta Ad Library (Port 3007) ⚠️ Requires ID Verification

| Tool | What It Does | Key Parameters |
|------|-------------|----------------|
| `search_ads` | Search ads by keyword | `search_terms`, `country`, `status` |
| `get_advertiser_ads` | Competitor's ads | `advertiser_name`, `status` |
| `analyze_ad_longevity` | Find proven winners | `advertiser_name`, `min_days_active` |
| `get_trending_creatives` | Industry trends | `industry_keywords`, `limit` |

---

## 💡 Common Use Cases

### Use Case 1: Get Best Performing Instagram Posts (Last 7 Days)

**HTTP Request:**
```json
{
  "tool": "get_media_with_insights",
  "arguments": {
    "limit": 25
  }
}
```

**Code Node (Filter Top Posts):**
```javascript
const response = $input.item.json;
const posts = JSON.parse(response.result.content[0].text);

// Filter posts from last 7 days
const sevenDaysAgo = new Date();
sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

// Sort by engagement rate
const topPosts = posts.data
  .filter(p => new Date(p.timestamp) > sevenDaysAgo)
  .map(p => ({
    caption: p.caption,
    impressions: p.insights?.impressions || 0,
    engagement: p.insights?.engagement || 0,
    engagement_rate: (p.insights?.engagement / p.insights?.impressions * 100).toFixed(2)
  }))
  .sort((a, b) => b.engagement_rate - a.engagement_rate)
  .slice(0, 5);

return topPosts.map(post => ({ json: post }));
```

---

### Use Case 2: Get Low-Performing Ad Campaigns

**HTTP Request 1 - Get All Active Campaigns:**
```json
{
  "tool": "get_campaigns",
  "arguments": {
    "status": "ACTIVE"
  }
}
```

**HTTP Request 2 - Get Campaign Insights (Loop):**
```json
{
  "tool": "get_campaign_insights",
  "arguments": {
    "campaign_id": "{{$json.id}}",
    "date_preset": "last_7d"
  }
}
```

**Code Node (Filter Low ROAS):**
```javascript
const insights = JSON.parse($input.item.json.result.content[0].text);

// Calculate ROAS (Return on Ad Spend)
const spend = parseFloat(insights.data[0]?.spend || 0);
const revenue = parseFloat(insights.data[0]?.conversions || 0) * 50; // Assuming $50 per conversion
const roas = spend > 0 ? revenue / spend : 0;

// Flag campaigns with ROAS < 2.0
if (roas < 2.0) {
  return {
    json: {
      campaign_name: $input.item.json.name,
      spend: spend,
      revenue: revenue,
      roas: roas.toFixed(2),
      alert: "⚠️ Low ROAS - Review campaign"
    }
  };
}
```

---

### Use Case 3: Competitor Ad Analysis

**HTTP Request:**
```json
{
  "tool": "analyze_ad_longevity",
  "arguments": {
    "advertiser_name": "Nike",
    "min_days_active": 90,
    "country": "US"
  }
}
```

**AI Agent Prompt:**
```
Analyze these long-running Nike ads:

{{$json.ads}}

Identify:
1. Common creative patterns
2. Messaging themes
3. Platform distribution
4. Recommendations for our client's campaigns

Focus on ads running 90+ days (proven winners).
```

---

## 🔍 Debugging Tips

### Check if service is running:
```bash
curl http://localhost:3005/health
```

Should return:
```json
{
  "status": "ok",
  "service": "instagram-analytics-mcp",
  "mcpReady": true
}
```

### List available tools:
```bash
curl http://localhost:3005/tools | jq '.result.tools[].name'
```

### Test a tool directly:
```bash
curl -X POST http://localhost:3005/call \
  -H "Content-Type: application/json" \
  -d '{"tool":"get_media","arguments":{"limit":2}}'
```

---

## 🎯 Best Practices

1. **Use `get_media_with_insights`** instead of separate calls - it's faster
2. **Limit API calls** - Use `limit` parameter to reduce response size
3. **Cache results** - Store in n8n variables if using data multiple times
4. **Error handling** - Always add an **IF** node to check for errors:
   ```javascript
   if ($input.item.json.error) {
     // Handle error
   }
   ```
5. **Batch processing** - Use Loop nodes to process multiple items efficiently

---

## 🐛 Common Errors & Solutions

| Error | Solution |
|-------|----------|
| "No credentials found" | User needs to complete OAuth flow |
| "Failed to decrypt access token" | Check ENCRYPTION_KEY in .env |
| "ACTION REQUIRED: Meta Ad Library..." | User must verify ID at facebook.com/id |
| "Request timeout" | Known issue - works better from n8n than curl |
| Connection refused | Service not running - check `docker ps` |

---

## 📚 Full Documentation

For complete API reference, see: `MCP-SERVICES-DOCUMENTATION.md`

For testing verification flow, run:
```bash
./test-ad-library-verification.sh
```
