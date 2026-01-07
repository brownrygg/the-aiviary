# NocoDB Schema: Meta Credentials

This table stores Meta/Instagram/Facebook credentials received from the central OAuth broker.

## Table Name: `meta_credentials`

### Columns

| Column Name | Type | Required | Description |
|------------|------|----------|-------------|
| Id | Number (Auto-increment) | Yes | Primary key (auto-generated) |
| client_id | SingleLineText | Yes | Unique client identifier |
| access_token | LongText | Yes | Encrypted Meta access token |
| token_expires_at | DateTime | Yes | When the token expires |
| meta_user_id | SingleLineText | No | Facebook/Meta user ID |
| facebook_page_id | SingleLineText | No | Connected Facebook Page ID |
| instagram_business_account_id | SingleLineText | Yes | Instagram Business Account ID |
| ad_account_id | SingleLineText | No | Meta Ad Account ID (if available) |
| last_refreshed_at | DateTime | No | Last time credentials were updated |
| created_at | DateTime | Yes | Record creation timestamp (auto) |
| updated_at | DateTime | Yes | Record update timestamp (auto) |

### How to Create in NocoDB

1. **Access NocoDB**:
   - Go to http://localhost:8081 (or your NocoDB URL)
   - Log in

2. **Create Table**:
   - Click "+ Add new table"
   - Name it: `meta_credentials`
   - Click "Create"

3. **Add Columns** (click "+ " next to existing columns):

   ```
   Column: client_id
   Type: SingleLineText
   Mark as Required
   ```

   ```
   Column: access_token
   Type: LongText
   Mark as Required
   Note: This will store encrypted tokens
   ```

   ```
   Column: token_expires_at
   Type: DateTime
   Mark as Required
   ```

   ```
   Column: meta_user_id
   Type: SingleLineText
   ```

   ```
   Column: facebook_page_id
   Type: SingleLineText
   ```

   ```
   Column: instagram_business_account_id
   Type: SingleLineText
   Mark as Required
   ```

   ```
   Column: ad_account_id
   Type: SingleLineText
   ```

   ```
   Column: last_refreshed_at
   Type: DateTime
   ```

4. **Get Table ID for .env**:
   - In NocoDB, open the meta_credentials table
   - Look at the URL, it will be something like:
     `http://localhost:8081/#/nc/YOUR_BASE_ID/meta_credentials`
   - Copy YOUR_BASE_ID and use it in your .env file

## Alternative: Direct PostgreSQL Creation

If you prefer to create via SQL:

```sql
-- Connect to nocodb_db
\c nocodb_db

-- This is an example - NocoDB manages its own schema
-- Better to create through the NocoDB UI

-- You can query NocoDB's tables like this:
SELECT * FROM nc_YOUR_BASE_ID__meta_credentials;
```

## API Access

Once created, you can access via NocoDB API:

```bash
# Get all credentials
curl http://localhost:8080/api/v2/tables/meta_credentials/records \
  -H "xc-token: YOUR_NOCODB_API_TOKEN"

# Create a record
curl -X POST http://localhost:8080/api/v2/tables/meta_credentials/records \
  -H "xc-token: YOUR_NOCODB_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "test-client",
    "access_token": "encrypted_token_here",
    "token_expires_at": "2025-03-01T00:00:00Z",
    "instagram_business_account_id": "17841..."
  }'
```

## Security Notes

- `access_token` field stores ENCRYPTED tokens (via credential-receiver service)
- Never expose this table publicly
- Restrict NocoDB API token access
- Use ENCRYPTION_KEY env var for encryption/decryption
