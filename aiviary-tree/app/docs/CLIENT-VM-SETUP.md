# Client VM Setup Guide

This stack is designed to be deployed once per client, with complete data isolation.

## Architecture

```
Central OAuth Broker (one instance)
          ↓
This Client VM (one per client)
  ├─ n8n
  ├─ NocoDB
  ├─ Open-WebUI
  ├─ Credential Receiver (receives Meta tokens)
  ├─ NocoDB MCP
  └─ (Future) Meta Ads MCP + Instagram MCP
```

## Prerequisites

- Docker & Docker Compose
- Domain name (e.g., `clienta.yourdomain.com`)
- Central OAuth Broker deployed and running
- Meta App configured (via central broker)

## Initial Setup

### 1. Clone and Configure

```bash
cd /path/to/content-nest/app
cp .env.example .env
```

### 2. Generate Secure Keys

```bash
# Generate VM API Key (for central broker to authenticate)
openssl rand -hex 32

# Generate Encryption Key (for encrypting stored tokens)
openssl rand -hex 32

# Generate other secrets
openssl rand -hex 16  # Database passwords
openssl rand -hex 32  # JWT secrets
```

### 3. Edit .env File

Required variables:

```env
# VM Security
VM_API_KEY=<generated above - share with central broker>
ENCRYPTION_KEY=<generated above>

# NocoDB
NOCODB_API_TOKEN=<get from NocoDB after first login>
NOCODB_BASE_ID=<get from NocoDB after creating base>

# Client Identity
CLIENT_ID=clienta  # Must match registration in central broker
DOMAIN=clienta.yourdomain.com
```

### 4. Deploy

```bash
docker compose up -d
```

### 5. Configure NocoDB

1. **Access NocoDB**: http://localhost:8081
2. **Create Account** (first time)
3. **Create Base**: Name it after your client
4. **Get Base ID**: From URL: `/#/nc/BASE_ID/...`
5. **Create API Token**:
   - Account Settings → Tokens → Create Token
6. **Create `meta_credentials` Table**:
   - Follow guide in `database/nocodb-meta-credentials-schema.md`

7. **Update .env**:
   ```env
   NOCODB_API_TOKEN=your_token_here
   NOCODB_BASE_ID=your_base_id_here
   ```

8. **Restart credential-receiver**:
   ```bash
   docker compose restart credential-receiver
   ```

## Register with Central Broker

The central OAuth broker needs to know about this VM:

```bash
curl -X POST https://oauth.yourdomain.com/admin/clients \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "clienta",
    "client_name": "Client A",
    "vm_url": "https://clienta.yourdomain.com",
    "vm_api_key": "YOUR_VM_API_KEY_FROM_ENV"
  }'
```

## Client Onboarding Flow

### Option 1: Direct Link

Send client this link:

```
https://oauth.yourdomain.com/auth/meta?client_id=clienta
```

### Option 2: Custom Onboarding Page

Create a simple HTML page at `clienta.yourdomain.com/onboard`:

```html
<!DOCTYPE html>
<html>
<head>
  <title>Connect Your Instagram & Meta Ads</title>
</head>
<body>
  <h1>Welcome, Client A!</h1>
  <p>To get started, connect your Instagram and Meta Ads accounts.</p>
  <a href="https://oauth.yourdomain.com/auth/meta?client_id=clienta">
    <button>Connect Instagram & Meta Ads</button>
  </a>
</body>
</html>
```

### What Happens After OAuth

1. Client authorizes via Meta
2. Central broker receives tokens
3. Broker POSTs to `https://clienta.yourdomain.com/api/credentials`
4. Credential receiver stores in local NocoDB
5. Tokens are now available to n8n workflows and MCP servers

## Verify Setup

### Check Services

```bash
docker compose ps
```

All services should be "Up" and "healthy"

### Check Credential Receiver

```bash
curl http://localhost:3006/health
```

Should return:
```json
{
  "status": "ok",
  "service": "credential-receiver",
  "nocodb_configured": true
}
```

### Check Logs

```bash
docker compose logs -f credential-receiver
```

## Development Mode: Adding Client as App Tester

Since the Meta app is in Development Mode, each client must be added as an app tester:

1. **Get Client's Facebook Profile URL**
   - Example: `https://facebook.com/john.doe.12345`

2. **Add to Meta App**:
   - Go to developers.facebook.com
   - Select your app
   - Roles → Testers
   - Add tester by Facebook URL or user ID

3. **Client Accepts**:
   - Client will receive notification
   - Must accept tester role
   - Then can complete OAuth flow

## Testing

### 1. Test OAuth Flow

1. Open: `https://oauth.yourdomain.com/auth/meta?client_id=clienta`
2. Complete Meta authorization
3. Check if credentials appear in NocoDB

### 2. Test Credential API

```bash
curl http://localhost:3006/api/credentials
```

Should return stored credentials (without access_token for security)

## n8n Integration

Your n8n workflows can now:

1. **Fetch Credentials**:
   ```javascript
   // HTTP Request node
   GET http://credential-receiver:3006/api/credentials
   ```

2. **Use with Meta APIs**:
   ```javascript
   // Extract token from credential response
   const accessToken = $json.access_token;
   const igAccountId = $json.instagram_business_account_id;

   // Call Instagram Graph API
   GET https://graph.facebook.com/v18.0/${igAccountId}/insights
   Headers: { Authorization: `Bearer ${accessToken}` }
   ```

## Troubleshooting

### Credentials not received

1. Check central broker logs
2. Verify VM_API_KEY matches in both .env files
3. Verify VM URL is correct in central broker registration
4. Check firewall allows traffic on port 3006

### NocoDB connection fails

1. Verify NOCODB_API_TOKEN is correct
2. Verify NOCODB_BASE_ID is correct
3. Verify meta_credentials table exists
4. Check nocodb service is healthy

### OAuth fails

1. Verify client is added as App Tester in Meta app
2. Check client has Instagram Business account
3. Verify Instagram is connected to Facebook Page
4. Check central broker logs for errors

## Next Steps

- Set up MCP servers (Meta Ads, Instagram Analytics)
- Create n8n workflows for data collection
- Configure OpenWebUI for client interface
- Set up automated reporting

## Security Checklist

- [ ] VM_API_KEY is strong and unique
- [ ] ENCRYPTION_KEY is strong and unique
- [ ] Database passwords are strong
- [ ] NocoDB API token is restricted
- [ ] Firewall rules limit access to necessary ports
- [ ] SSL/TLS configured for public endpoints
- [ ] Regular backups configured
