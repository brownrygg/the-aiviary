# n8n Workflow Service

n8n is the workflow automation engine that powers the Aiviary Tree.

## Configuration

n8n uses the `n8n_db` database (isolated from other components).

### Environment Variables

Key variables in `.env`:
```env
N8N_VERSION=1.122.3
TIMEZONE=Europe/Zagreb
WEBHOOK_URL=https://n8n.yourdomain.com
VUE_APP_URL_BASE_API=https://n8n.yourdomain.com
```

## Accessing n8n

- **URL**: `https://n8n.{DOMAIN}/`
- **Routed through**: nginx reverse proxy
- **Recommended**: Restrict via Tailscale for admin-only access

## Workflow Storage

Export workflows for version control:
```bash
# Export all workflows
docker exec n8n n8n export:workflow --all --output=/home/node/.n8n/workflows/

# Import workflows
docker exec n8n n8n import:workflow --input=/path/to/workflow.json
```

## Integration with Aiviary Components

### Aiviary Chat Integration
- Create webhook workflows that respond to chat agent requests
- Configure agent `webhook_url` to point to n8n webhooks
- Example: `/webhook/analytics-report` triggers a workflow that generates reports

### Aiviary Connect Integration
- OAuth credentials flow through n8n for branches
- Use n8n's OAuth2 nodes for services like Slack, Google, Asana

### Nest Integration
- Trigger workflows based on sync events
- Schedule data sync via cron triggers
- Process enrichment results

## Common Workflow Patterns

### 1. Scheduled Analytics Report
```
Cron (weekly) -> Query nest_meta -> Format report -> Send email/Slack
```

### 2. Real-time Alert
```
Webhook (from sync-worker) -> Check thresholds -> Send notification
```

### 3. Chat Agent Response
```
Webhook (from chat) -> Query database -> Transform data -> Return response
```

## Database

- **Name**: `n8n_db`
- **Tables**: Managed by n8n automatically
- **Isolated**: Separate from analytics and chat databases
