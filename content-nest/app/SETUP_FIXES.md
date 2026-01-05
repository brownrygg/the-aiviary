# Setup Fixes & Troubleshooting

This document outlines common issues and their fixes for the social automation platform client VM setup.

## ✅ Fixed Issues (January 2, 2026)

### 1. Onboarding Page Not Auto-Configured

**Problem:** `setup.sh` didn't automatically customize the `nginx/html/index.html` file with the correct OAuth broker URL and client ID.

**Impact:**
- OAuth links pointed to wrong broker URL (e.g., `oauth.rikkcontent.com` instead of `meta-oauth.rikkcontent.com`)
- Client ID was hardcoded (e.g., `clienta` instead of actual client like `tanya`)
- Users had to manually edit HTML file for each new client VM

**Fix:**
- Added Step 5 to `setup.sh` that automatically updates `index.html`
- Uses `sed` to replace `OAUTH_BROKER_URL` with `${BROKER_URL}`
- Uses `sed` to replace `CLIENT_ID` with `${CLIENT_ID_BROKER}`
- Sets correct file permissions (644) automatically

**Now automated:**
```bash
./setup.sh
# Automatically customizes index.html with:
# - OAUTH_BROKER_URL = 'https://meta-oauth.rikkcontent.com'
# - CLIENT_ID = 'tanya' (or whatever client ID you specify)
```

### 2. Cloudflare Tunnel Routing to Wrong Service

**Problem:** `setup.sh` instructed users to route Cloudflare Tunnel to `credential-receiver:3006` instead of `nginx:443`.

**Impact:**
- Root domain showed "Cannot GET /" error
- Onboarding dashboard HTML page was not accessible
- Users saw JSON API responses instead of the HTML interface

**Fix:**
- Updated `setup.sh` lines 177-178 and 485
- Changed instructions from `credential-receiver:3006` to `nginx:443`
- Changed service type from HTTP to HTTPS

**Correct Cloudflare Tunnel Configuration:**
```
Service Type: HTTPS
Service URL: nginx:443
No TLS Verify: ✓ (enabled)
```

**Why nginx?**
- nginx serves the onboarding HTML page at the root domain
- nginx proxies `/api/status` to credential-receiver internally
- All subdomain routing (n8n, chat, nocodb) goes through nginx

### 3. Port Conflicts (Open WebUI)

**Problem:** `setup.sh` and `.env.example` configured `OPENWEBUI_PORT=3000`, which conflicts with the central OAuth broker.

**Impact:**
- Docker compose failed to start with "port already allocated" error
- Services couldn't start properly

**Fix:**
- Updated `setup.sh` line 279 to use port 4002
- Updated `.env.example` line 15 to use port 4002
- Updated `docker-compose.yml` to use ports 8092:80 and 8445:443 for nginx (avoiding host conflicts with Tailscale)

**Correct Ports:**
```
OPENWEBUI_PORT=4002
nginx: 8092:80, 8445:443 (host:container)
```

### 4. HTML File Permissions

**Problem:** Onboarding `index.html` had restrictive permissions (600) causing nginx 403 errors.

**Fix:**
```bash
chmod 644 nginx/html/index.html
```

**Note:** nginx needs read access to serve static files.

---

## 🔧 Known Issues & Fixes

### n8n Encryption Key Mismatch

**Symptom:**
```
Error: Mismatching encryption keys. The encryption key in the settings file
/home/node/.n8n/config does not match the N8N_ENCRYPTION_KEY env var.
```

**Cause:**
Old n8n config file exists with different `ENCRYPTION_KEY` than what's in current `.env`.

**Fix Option 1 - Automated Script:**
```bash
./fix-n8n-encryption.sh
```

**Fix Option 2 - Manual:**
```bash
# Stop n8n
docker compose down n8n n8n-worker

# Remove old config
sudo rm -f /var/lib/docker/volumes/app_n8n_storage/_data/config

# Restart n8n
docker compose up -d n8n n8n-worker
```

**Prevention:**
Never change `ENCRYPTION_KEY` in `.env` after first deployment. If you must change it, you need to delete the volume and start fresh (losing all n8n workflow data).

---

## 📝 Setup Checklist (Correct Process)

### 1. Cloudflare Tunnel Setup

1. Create tunnel at https://one.dash.cloudflare.com/
2. Navigate to: Zero Trust → Networks → Tunnels
3. Click "Create a tunnel"
4. Tunnel name: `{client-id}-vm` (e.g., `tanya-vm`)
5. Copy the tunnel token
6. **Configure Public Hostname:**
   - Subdomain: `{client-id}` (e.g., `tanya`)
   - Domain: `rikkcontent.com`
   - Service Type: **HTTPS** ⚠️
   - Service URL: **nginx:443** ⚠️
   - Additional settings:
     - No TLS Verify: ✓ **Enable this**
7. Click "Save hostname"

### 2. Run Setup Script

```bash
cd content-nest/app
./setup.sh
```

The script will:
- Prompt for client details
- Ask for Cloudflare Tunnel token
- Generate secure keys
- Create .env file
- Start services
- Register with OAuth broker

### 3. Verify Setup

```bash
# Check all services are running
docker compose ps

# Check nginx is serving HTML
curl -k https://localhost:8445/ | head -20

# Check public URL (after tunnel connects)
curl https://{client-id}.rikkcontent.com/ | head -20

# Should see HTML starting with: <!DOCTYPE html>
```

### 4. Test Onboarding Page

1. Open browser: `https://{client-id}.rikkcontent.com`
2. Should see purple gradient page with service cards
3. Meta/Instagram card should show "Checking..." then "Not Connected"
4. Click "Connect Instagram" → redirects to OAuth broker
5. After OAuth → card shows "Connected" ✅

---

## 🔍 Debugging

### Cloudflare Tunnel Not Working

```bash
# Check tunnel logs
docker compose logs cloudflared

# Should see:
# "Registered tunnel connection"
# "Updated to new configuration"

# Check if tunnel config shows nginx:443
docker compose logs cloudflared | grep -A 10 "Updated to new configuration"
```

**If showing `credential-receiver:3006`:**
1. Go to Cloudflare Dashboard → Zero Trust → Networks → Tunnels
2. Click on your tunnel
3. Edit the Public Hostname
4. Change Service URL to `nginx:443`
5. Enable "No TLS Verify"
6. Save

### Nginx Not Serving HTML

```bash
# Check nginx logs
docker compose logs nginx | tail -30

# Check if HTML file is mounted
docker compose exec nginx ls -la /usr/share/nginx/html/

# Should show:
# -rw-r--r-- 1 1000 1000 12999 ... index.html

# Test nginx directly
curl -k https://localhost:8445/

# Should return HTML, not 403 or error
```

### Port Conflicts

```bash
# Find what's using a port
ss -tuln | grep :3000
ss -tuln | grep :443
ss -tuln | grep :80

# Docker containers using ports
docker ps --format "table {{.Names}}\t{{.Ports}}"

# If conflicts exist:
# 1. Update .env with different OPENWEBUI_PORT
# 2. Restart services: docker compose restart
```

### Service Can't Connect

```bash
# Check Docker network
docker network ls
docker network inspect app_default

# All services should be on same network
# credential-receiver, nginx, n8n, etc.

# Test internal connectivity
docker compose exec nginx ping -c 2 credential-receiver
docker compose exec nginx curl -f http://credential-receiver:3006/health
```

---

## 📋 Environment Variables Reference

### Required Variables

```bash
# Client Identity
CLIENT_ID=client  # Always 'client' for single-tenant VMs

# Security
VM_API_KEY=<64-char hex>        # Generate: openssl rand -hex 32
ENCRYPTION_KEY=<64-char hex>    # Generate: openssl rand -hex 32 (NEVER CHANGE!)

# Cloudflare
CLOUDFLARE_TUNNEL_TOKEN=<token>

# Domain
DOMAIN=client-name.rikkcontent.com

# Ports
OPENWEBUI_PORT=4002
```

### Optional Variables

```bash
# NocoDB (set after first login)
NOCODB_API_TOKEN=
NOCODB_BASE_ID=

# Custom timezone
TIMEZONE=Europe/Zagreb

# n8n version
N8N_VERSION=1.123.4

# OpenWebUI version
OPENWEBUI_VERSION=v0.6.40
```

---

## 🚨 Critical Notes

### DO NOT Change After First Deployment

- `ENCRYPTION_KEY` - Used to encrypt stored credentials. Changing breaks all existing credentials.
- `CLIENT_ID` - Always keep as `client` for single-tenant architecture.

### Must Match Between Systems

- `VM_API_KEY` - Must match in both:
  - Client VM `.env`
  - Central broker registration

### Port Allocation

- OAuth Broker uses: `3000`
- Client VM Open WebUI uses: `4002` (avoid 3000)
- nginx host ports: `8092`, `8445` (avoid 80, 443 - used by Tailscale)

---

## 📞 Support

If you encounter issues not covered here:

1. Check service logs:
   ```bash
   docker compose logs -f <service-name>
   ```

2. Check service status:
   ```bash
   docker compose ps
   ```

3. Restart specific service:
   ```bash
   docker compose restart <service-name>
   ```

4. Full restart:
   ```bash
   docker compose down
   docker compose up -d
   ```

---

### 5. Docker Compose Project Name Conflict (CRITICAL)

**Problem:** Multiple services (OAuth broker, Tanya VM) were using the same Docker Compose project name "app", causing container name conflicts. Tanya's `cloudflared` service **never started** because the OAuth broker already had a container named `cloudflared`.

**Impact:**
- Tanya VM cloudflared never ran
- Error 1033 (Cloudflare can't reach origin)
- OAuth flow completely broken
- Running `docker compose ps` showed the WRONG cloudflared
- Extremely difficult to diagnose

**Root Cause:**
```bash
OAuth broker:     project=app, container=cloudflared
Tanya VM:         project=app, container=cloudflared  ← CONFLICT!
```

**Fix:**
- Changed container name to use dynamic client ID: `${CLIENT_ID_BROKER:-client}-cloudflared`
- Now each client gets unique container name: `tanya-cloudflared`, `clientb-cloudflared`, etc.
- Updated docker-compose.yml line 241

**Prevention:**
Future clients automatically get unique container names based on their CLIENT_ID_BROKER from `.env`.

---

**Last Updated:** January 2, 2026
**Fixed By:** Claude Code
**Issues Fixed:** 5 (Auto-configuration, Cloudflare routing, port conflicts, file permissions, container name conflicts)
