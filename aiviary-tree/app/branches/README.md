# Branches

Branches are communication and project management integrations that extend the Aiviary Tree's capabilities beyond social media analytics.

## Purpose

While **Nests** handle social media platforms with complex data sync requirements, **Branches** integrate with:
- Communication tools (Slack, Discord, email)
- Project management (Asana, Monday.com, Notion)
- File storage (Google Drive, Dropbox)
- CRM systems (HubSpot, Salesforce)

## Architecture

Each branch follows the same pattern as nests:
- Own database (e.g., `branch_slack`, `branch_asana`)
- MCP server for agent access
- Credentials stored via n8n
- Isolated for easy addition/removal

## Planned Branches

### Communication
- **Slack Branch**: Channel monitoring, message search, notifications
- **Discord Branch**: Server analytics, community engagement
- **Email Branch**: Campaign analytics, inbox monitoring

### Project Management
- **Asana Branch**: Task tracking, project timelines, workload analysis
- **Monday.com Branch**: Board analytics, automation triggers
- **Notion Branch**: Database sync, page analytics

### File Storage
- **Google Drive Branch**: Document indexing, collaboration analytics
- **Dropbox Branch**: File sync status, sharing analytics

## Creating a New Branch

1. Create directory structure:
   ```
   branches/
   └── slack/
       ├── mcp/
       │   └── slack-mcp/
       ├── README.md
       └── (optional workers if needed)
   ```

2. Add database to `shared/database/init.sh`:
   ```bash
   # Branch: Slack
   psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "postgres" <<-EOSQL
       SELECT 'CREATE DATABASE branch_slack WITH OWNER = ''${POSTGRES_NON_ROOT_USER}'''
       WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'branch_slack')\gexec
   EOSQL
   ```

3. Add services to `docker-compose.yml`:
   ```yaml
   slack-mcp:
     build:
       context: ./branches/slack/mcp/slack-mcp
     container_name: slack-mcp
     environment:
       - POSTGRES_DB=branch_slack
     # ... other config
   ```

4. Credentials are managed through n8n OAuth nodes, automatically imported via Aiviary Connect when the user authorizes.
