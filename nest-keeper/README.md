# Meta Central OAuth Broker

Central OAuth service for managing multi-tenant Meta/Instagram authentication across distributed client VMs.

## Architecture

```
Client A → OAuth Broker → Client A VM
Client B → OAuth Broker → Client B VM
Client C → OAuth Broker → Client C VM
```

## Features

- **Centralized OAuth**: Single Meta Developer App for all clients
- **Token Distribution**: Routes OAuth tokens to correct client VM
- **Client Registry**: Maps clients to their VMs
- **Event Logging**: Tracks all OAuth flows
- **Admin API**: Manage client-VM mappings

## Setup

### 1. Prerequisites

- Meta Developer App (App ID & Secret)
- Domain with HTTPS (for OAuth redirect URI)
- Docker & Docker Compose

### 2. Configuration

```bash
cd app
cp .env.example .env
```

Edit `.env` and set:

```env
META_APP_ID=your_app_id
META_APP_SECRET=your_app_secret
OAUTH_REDIRECT_URI=https://oauth.yourdomain.com/callback
BASE_URL=https://oauth.yourdomain.com
ENCRYPTION_KEY=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
```

### 3. Deploy

```bash
docker compose up -d
```

### 4. Register Your First Client

```bash
curl -X POST http://localhost:3000/admin/clients \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "test-client-a",
    "client_name": "Test Client A",
    "vm_url": "https://clienta-stack.yourdomain.com",
    "vm_api_key": "secure_random_api_key_here"
  }'
```

## OAuth Flow

### Client initiates OAuth:

```
https://oauth.yourdomain.com/auth/meta?client_id=test-client-a
```

### After authorization, broker:

1. Exchanges code for access token
2. Gets Instagram Business Account ID
3. Gets Ad Account ID (if available)
4. POSTs credentials to client VM at `/api/credentials`

## API Endpoints

### OAuth

- `GET /auth/meta?client_id={id}` - Initiate OAuth flow
- `GET /callback` - OAuth callback (set in Meta app)

### Admin

- `GET /admin/clients` - List all clients
- `POST /admin/clients` - Register new client
- `PUT /admin/clients/:client_id` - Update client
- `DELETE /admin/clients/:client_id` - Delete client
- `GET /admin/events?client_id={id}` - View OAuth event logs

### Health

- `GET /health` - Health check

## Database Schema

### client_vm_registry
- Maps client_id → VM URL + API key
- Stores client status

### oauth_events
- Logs all OAuth flows
- Tracks success/failures
- Records token forwarding

### app_testers
- Tracks Meta app testers (for Development Mode)

## Security

- Encryption key for state parameters
- VM API keys for secure forwarding
- Event logging for audit trail
- PostgreSQL for persistent storage
- Redis for caching (future use)

## Development Mode Notes

Since app is in Development Mode:
- Clients must be added as "App Testers" in Meta App dashboard
- Up to 500 testers allowed
- Full API access, just restricted to testers

## Transition to Live Mode

When ready:
1. Complete Business Verification
2. Apply for Tech Provider status
3. Switch app to Live Mode
4. Update Meta app redirect URIs if needed
