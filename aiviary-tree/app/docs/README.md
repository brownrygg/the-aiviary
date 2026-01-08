# Content Aiviary - Client VM Setup

## Quick Start (Brand New VM)

```bash
# 1. Clone and enter directory
git clone <repo-url>
cd content-nest/app

# 2. Copy and configure .env
cp .env.example .env
# Edit .env - set CLIENT_ID and generate secrets

# 3. Run setup
./setup.sh

# 4. Get NocoDB token (one-time)
# Visit http://localhost:8081
# Create account → Settings → Tokens → Create
# Add token to .env: NOCODB_API_TOKEN=xxx

# 5. Restart
docker compose restart credential-receiver

# Done! System auto-configures everything else.
```

## OAuth Link
```
https://oauth.theaiviary.com/auth/meta?client_id=<YOUR_CLIENT_ID>
```

## Monitoring
```bash
docker compose logs -f credential-receiver  # OAuth callbacks
docker compose logs -f sync-worker          # Backfill progress
```
