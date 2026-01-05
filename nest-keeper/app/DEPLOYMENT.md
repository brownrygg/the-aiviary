# Meta Central OAuth Broker - Deployment Guide

## Quick Start

### 1. Configure Environment

```bash
cd ~/services/nest-keeper/app
cp .env.example .env
```

Edit `.env`:

```env
# From your Meta Developer App
META_APP_ID=123456789...
META_APP_SECRET=abc123...

# PostgreSQL
POSTGRES_DB=oauth_broker
POSTGRES_USER=oauth_user
POSTGRES_PASSWORD=$(openssl rand -hex 16)

# Encryption key (32 bytes hex)
ENCRYPTION_KEY=$(openssl rand -hex 32)

# Your domain (where this service is accessible)
OAUTH_REDIRECT_URI=https://oauth.yourdomain.com/callback
BASE_URL=https://oauth.yourdomain.com
```

### 2. Update Meta App Settings

Go to developers.facebook.com → Your App → Facebook Login → Settings

Add to **Valid OAuth Redirect URIs**:
```
https://oauth.yourdomain.com/callback
```

### 3. Deploy

```bash
# Option 1: Use startup script (recommended - ensures all services start)
./start.sh

# Option 2: Direct docker compose
docker compose up -d
```

### 4. Verify

```bash
curl http://localhost:3000/health
```

Should return:
```json
{
  "status": "ok",
  "service": "meta-oauth-broker"
}
```

### 5. Register First Client

```bash
curl -X POST http://localhost:3000/admin/clients \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "test-client-a",
    "client_name": "Test Client A",
    "vm_url": "https://clienta-stack.yourdomain.com",
    "vm_api_key": "secure_random_key_here"
  }'
```

## Production Deployment

### Option 1: Behind Cloudflare Tunnel (Included)

Cloudflared is already configured in docker-compose.yml and will start automatically when you run `./start.sh` or `docker compose up -d`.

**Setup:**
1. Create tunnel in Cloudflare dashboard (Zero Trust → Networks → Tunnels)
2. Copy tunnel token to `.env`:
   ```env
   CLOUDFLARE_TUNNEL_TOKEN=eyJ...
   ```
3. Configure tunnel to route `oauth.yourdomain.com` → `http://oauth-broker:3000`
4. Start services: `./start.sh`

### Option 2: Behind Nginx

```nginx
server {
    listen 443 ssl;
    server_name oauth.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Managing Clients

### List All Clients

```bash
curl http://localhost:3000/admin/clients
```

### Update Client

```bash
curl -X PUT http://localhost:3000/admin/clients/test-client-a \
  -H "Content-Type: application/json" \
  -d '{
    "status": "inactive"
  }'
```

### Delete Client

```bash
curl -X DELETE http://localhost:3000/admin/clients/test-client-a
```

### View OAuth Event Logs

```bash
# All events
curl http://localhost:3000/admin/events

# For specific client
curl http://localhost:3000/admin/events?client_id=test-client-a

# Last 50 events
curl http://localhost:3000/admin/events?limit=50
```

## Adding Clients as App Testers (Development Mode)

Since your Meta app is in Development Mode, each client must be added as an app tester:

1. **Get Client's Facebook Profile**:
   - Ask client for their Facebook profile URL
   - Example: `https://facebook.com/jane.doe`

2. **Add in Meta App Dashboard**:
   - Go to developers.facebook.com
   - Select your app
   - Roles → Testers → Add Testers
   - Paste Facebook profile URL
   - Click "Submit"

3. **Client Accepts**:
   - Client receives Facebook notification
   - Must click "Accept" to become tester
   - Can now complete OAuth flow

4. **Track in Database** (optional):
   ```bash
   docker compose exec postgres psql -U oauth_user -d oauth_broker
   ```

   ```sql
   INSERT INTO app_testers (client_id, facebook_user_id, facebook_name, tester_status)
   VALUES ('test-client-a', '12345678', 'Jane Doe', 'invited');
   ```

## OAuth Flow Testing

### Full Flow Test

1. **Start OAuth**:
   ```
   https://oauth.yourdomain.com/auth/meta?client_id=test-client-a
   ```

2. **Expected Flow**:
   - Redirects to Facebook authorization
   - Client logs in and grants permissions
   - Redirects back to `/callback`
   - Exchanges code for token
   - Fetches Instagram/Facebook account info
   - POSTs to client VM
   - Redirects to client VM success page

3. **Check Logs**:
   ```bash
   docker compose logs -f oauth-broker
   ```

4. **Verify in Database**:
   ```sql
   SELECT * FROM oauth_events ORDER BY created_at DESC LIMIT 5;
   ```

## Troubleshooting

### OAuth fails with "Client not found"

- Verify client is registered: `curl http://localhost:3000/admin/clients`
- Check client_id matches exactly

### "Invalid redirect_uri" error

- Verify OAUTH_REDIRECT_URI in .env matches Meta app settings
- Check for http vs https mismatch

### Client not added as tester

- Error: "This app is in development mode"
- Solution: Add client as app tester in Meta dashboard

### Token forwarding fails

- Check client VM is accessible from broker
- Verify VM_API_KEY matches on both sides
- Check client VM credential-receiver is running

### Database connection fails

- Check PostgreSQL is running: `docker compose ps postgres`
- Verify credentials in .env
- Check logs: `docker compose logs postgres`

## Monitoring

### Health Check

```bash
# Add to cron or monitoring service
curl -f http://localhost:3000/health || alert
```

### Database Queries

```sql
-- Recent OAuth events
SELECT client_id, event_type, created_at
FROM oauth_events
ORDER BY created_at DESC
LIMIT 10;

-- Success rate by client
SELECT
  client_id,
  COUNT(*) FILTER (WHERE event_type = 'oauth_success') as successes,
  COUNT(*) FILTER (WHERE event_type LIKE '%error%') as errors
FROM oauth_events
GROUP BY client_id;

-- Active clients
SELECT client_id, client_name, last_oauth_at
FROM client_vm_registry
WHERE status = 'active'
ORDER BY last_oauth_at DESC;
```

## Backup & Recovery

### Backup Database

```bash
docker compose exec postgres pg_dump -U oauth_user oauth_broker > backup.sql
```

### Restore Database

```bash
cat backup.sql | docker compose exec -T postgres psql -U oauth_user oauth_broker
```

## Security Checklist

- [ ] ENCRYPTION_KEY is strong (32 bytes hex)
- [ ] PostgreSQL password is strong
- [ ] OAuth broker accessible only via HTTPS
- [ ] VM_API_KEY is unique per client
- [ ] Database backups configured
- [ ] Logs monitored for unauthorized access
- [ ] Rate limiting configured (if public)
- [ ] CORS configured appropriately

## Transition to Live Mode

When ready to move Meta app from Development to Live Mode:

1. **Complete Business Verification**
   - Submit business documents to Meta
   - Wait for approval (1-3 days)

2. **Apply for Tech Provider Status**
   - Required for serving 3rd party clients
   - May take 1-2 weeks

3. **Switch App to Live**
   - In Meta dashboard: Settings → Advanced → App Mode → Live

4. **Update App Review (if needed)**
   - Request advanced access for any permissions needing it
   - Submit for app review with screencast

5. **No Code Changes Needed**
   - This OAuth broker works identically in Live Mode
   - Just remove "app tester" requirement

## Support

For issues:
1. Check logs: `docker compose logs -f`
2. Check database: `docker compose exec postgres psql...`
3. Review OAuth events table
4. Verify Meta app configuration
