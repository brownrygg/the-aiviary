# Chat Streaming API Guide

## Overview

This FastAPI backend provides a complete multi-tenant chat system with n8n webhook integration and Server-Sent Events (SSE) streaming.

## Architecture

```
User Request → FastAPI → n8n Webhook → Streaming Response → Database
                ↓
            JWT Auth
                ↓
         Team Isolation
```

## Key Features

- **Multi-tenant isolation** via team_id
- **JWT authentication** with httpOnly cookies
- **Server-Sent Events (SSE)** for real-time streaming
- **n8n webhook integration** for AI agents
- **JSONB message storage** (Open WebUI pattern)
- **Role-based access control** (user/admin)

## Data Models

### Team
- `id`: UUID (primary key)
- `name`: Team name
- `slug`: URL-friendly identifier
- `settings`: JSONB configuration
- `is_active`: Boolean

### User
- `id`: UUID (primary key)
- `team_id`: UUID (foreign key)
- `email`: Text (unique within team)
- `password_hash`: Text (bcrypt)
- `role`: "user" or "admin"
- `avatar`: Base64 data URI
- `preferences`: JSONB

### Agent
- `id`: UUID (primary key)
- `team_id`: UUID (foreign key)
- `created_by`: UUID (foreign key to User)
- `name`: Agent name
- `webhook_url`: n8n webhook URL
- `webhook_token`: Bearer token for auth
- `system_prompt`: Agent instructions
- `config`: JSONB (model settings)

### Chat
- `id`: UUID (primary key)
- `team_id`: UUID (foreign key)
- `user_id`: UUID (foreign key)
- `agent_id`: UUID (foreign key)
- `title`: Chat title
- `messages`: JSONB array
- `metadata`: JSONB
- `is_archived`: Boolean

## API Endpoints

### Authentication

#### Register User
```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePass123",
  "full_name": "John Doe",
  "team_id": "550e8400-e29b-41d4-a716-446655440001"
}
```

**Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "team_id": "550e8400-e29b-41d4-a716-446655440001",
  "email": "user@example.com",
  "full_name": "John Doe",
  "role": "user",
  "is_active": true,
  "created_at": "2025-01-01T00:00:00"
}
```

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePass123"
}
```

**Response:**
- Sets `access_token` and `refresh_token` in httpOnly cookies
- Returns `{"message": "Login successful"}`

#### Get Current User
```http
GET /api/auth/me
Cookie: access_token=<jwt_token>
```

**Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "team_id": "550e8400-e29b-41d4-a716-446655440001",
  "email": "user@example.com",
  "full_name": "John Doe",
  "role": "user",
  "avatar": null,
  "preferences": {},
  "is_active": true,
  "last_login_at": "2025-01-15T10:30:00",
  "created_at": "2025-01-01T00:00:00"
}
```

### Agents

#### List Agents
```http
GET /api/agents
Cookie: access_token=<jwt_token>
```

**Query Parameters:**
- `include_inactive` (bool, default: false)

**Response:**
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440002",
    "team_id": "550e8400-e29b-41d4-a716-446655440001",
    "created_by": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Support Bot",
    "description": "Customer support assistant",
    "webhook_url": "https://n8n.example.com/webhook/support-bot",
    "webhook_token": "secret_token_123",
    "system_prompt": "You are a helpful customer support assistant.",
    "avatar": null,
    "config": {"model": "gpt-4", "temperature": 0.7},
    "is_active": true,
    "created_at": "2025-01-01T00:00:00",
    "updated_at": "2025-01-01T00:00:00"
  }
]
```

#### Create Agent (Admin Only)
```http
POST /api/agents
Cookie: access_token=<jwt_token>
Content-Type: application/json

{
  "name": "Support Bot",
  "description": "Customer support assistant",
  "webhook_url": "https://n8n.example.com/webhook/support-bot",
  "webhook_token": "secret_token_123",
  "system_prompt": "You are a helpful customer support assistant.",
  "config": {
    "model": "gpt-4",
    "temperature": 0.7,
    "max_tokens": 2000
  }
}
```

#### Update Agent (Admin Only)
```http
PUT /api/agents/{agent_id}
Cookie: access_token=<jwt_token>
Content-Type: application/json

{
  "name": "Support Bot Updated",
  "is_active": false
}
```

#### Delete Agent (Admin Only)
```http
DELETE /api/agents/{agent_id}
Cookie: access_token=<jwt_token>
```

#### Upload Agent Avatar (Admin Only)
```http
POST /api/agents/{agent_id}/avatar
Cookie: access_token=<jwt_token>
Content-Type: multipart/form-data

file: <image_file>
```

**Supported formats:** PNG, JPG, JPEG, GIF, WebP
**Max size:** 2MB

### Chats

#### List Chats
```http
GET /api/chats
Cookie: access_token=<jwt_token>
```

**Query Parameters:**
- `include_archived` (bool, default: false)
- `limit` (int, default: 50)
- `offset` (int, default: 0)

**Response:**
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440003",
    "team_id": "550e8400-e29b-41d4-a716-446655440001",
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "agent_id": "550e8400-e29b-41d4-a716-446655440002",
    "title": "Support Request",
    "messages": [
      {
        "role": "user",
        "content": "Hello, I need help",
        "timestamp": "2025-01-01T10:00:00"
      },
      {
        "role": "assistant",
        "content": "Hi! How can I assist you?",
        "timestamp": "2025-01-01T10:00:05"
      }
    ],
    "metadata": {"tags": ["support"]},
    "is_archived": false,
    "created_at": "2025-01-01T00:00:00",
    "updated_at": "2025-01-01T00:00:10"
  }
]
```

#### Create Chat
```http
POST /api/chats
Cookie: access_token=<jwt_token>
Content-Type: application/json

{
  "agent_id": "550e8400-e29b-41d4-a716-446655440002",
  "title": "Support Request",
  "metadata": {"tags": ["support"]}
}
```

#### Get Chat
```http
GET /api/chats/{chat_id}
Cookie: access_token=<jwt_token>
```

#### Update Chat
```http
PUT /api/chats/{chat_id}
Cookie: access_token=<jwt_token>
Content-Type: application/json

{
  "title": "Updated Support Request",
  "is_archived": false
}
```

#### Delete Chat
```http
DELETE /api/chats/{chat_id}
Cookie: access_token=<jwt_token>
```

### Message Streaming (SSE)

#### Send Message and Stream Response
```http
POST /api/chats/{chat_id}/messages
Cookie: access_token=<jwt_token>
Content-Type: application/json
Accept: text/event-stream

{
  "content": "Hello, I need help with my account"
}
```

**Response (Server-Sent Events):**
```
data: {"type":"status","data":{"description":"Sending request to n8n webhook...","level":"info","done":false}}

data: {"type":"message","data":{"content":"Hi"}}

data: {"type":"message","data":{"content":" there!"}}

data: {"type":"message","data":{"content":" How"}}

data: {"type":"message","data":{"content":" can"}}

data: {"type":"message","data":{"content":" I"}}

data: {"type":"message","data":{"content":" help"}}

data: {"type":"message","data":{"content":" you?"}}

data: {"type":"done","data":{"message":"Stream completed"}}
```

**Event Types:**
- `status`: Status updates (info, warning, error)
- `message`: Streamed message chunks
- `done`: Stream completed
- `error`: Error occurred

## Frontend Integration Examples

### JavaScript/TypeScript (Fetch API)

```javascript
// Send message and stream response
async function sendMessage(chatId, content) {
  const response = await fetch(`/api/chats/${chatId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include', // Include cookies
    body: JSON.stringify({ content })
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6));

        if (data.type === 'message') {
          console.log('Message chunk:', data.data.content);
          // Append to UI
        } else if (data.type === 'status') {
          console.log('Status:', data.data.description);
        } else if (data.type === 'done') {
          console.log('Stream completed');
        } else if (data.type === 'error') {
          console.error('Error:', data.data.message);
        }
      }
    }
  }
}
```

### React with EventSource

```jsx
import { useEffect, useState } from 'react';

function ChatMessage({ chatId, content }) {
  const [response, setResponse] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    const sendMessage = async () => {
      const res = await fetch(`/api/chats/${chatId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content })
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));

            if (data.type === 'message') {
              setResponse(prev => prev + data.data.content);
            } else if (data.type === 'status') {
              setStatus(data.data.description);
            }
          }
        }
      }
    };

    sendMessage();
  }, [chatId, content]);

  return (
    <div>
      <p>Status: {status}</p>
      <p>Response: {response}</p>
    </div>
  );
}
```

## n8n Webhook Configuration

Your n8n workflow should:

1. **Accept POST requests** with this payload:
```json
{
  "messages": [
    {"role": "user", "content": "Hello", "timestamp": "2025-01-01T10:00:00"},
    {"role": "assistant", "content": "Hi!", "timestamp": "2025-01-01T10:00:05"}
  ],
  "system_prompt": "You are a helpful assistant.",
  "config": {
    "model": "gpt-4",
    "temperature": 0.7
  }
}
```

2. **Return streaming response** (SSE format):
```
data: {"content": "Hi"}

data: {"content": " there!"}

data: [DONE]
```

Or **return complete response** (JSON):
```json
{
  "content": "Hi there! How can I help you?"
}
```

3. **Support bearer token authentication** (optional):
```
Authorization: Bearer <webhook_token>
```

## Security Considerations

1. **Authentication:**
   - All endpoints except `/api/auth/register` and `/api/auth/login` require authentication
   - JWT tokens stored in httpOnly cookies (XSS protection)
   - SameSite=Strict (CSRF protection)

2. **Authorization:**
   - Users can only access their own chats
   - Agents filtered by team_id
   - Admin role required for agent CRUD

3. **Multi-tenancy:**
   - All data isolated by team_id
   - Email unique within team (same email can exist in different teams)

4. **Rate Limiting:**
   - Login endpoint rate limited (5 attempts per minute per IP)
   - Consider adding rate limiting to chat endpoints in production

5. **Input Validation:**
   - All inputs validated via Pydantic
   - Avatar file type and size validation
   - UUID validation for all IDs

## Database Setup

Run the schema.sql file to create tables:

```bash
psql -U <username> -d <database> -f /home/rikk/schema.sql
```

## Environment Variables

Create `/home/rikk/backend/.env`:

```env
# Database
DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/app_db

# JWT
JWT_SECRET_KEY=<generate_with_openssl_rand_hex_32>

# Environment
ENVIRONMENT=development  # or production

# CORS
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

## Running the Application

```bash
cd /home/rikk/backend

# Install dependencies
pip install -r requirements.txt

# Run development server
python main.py

# Or use uvicorn directly
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Production (with gunicorn)
gunicorn main:app -w 4 -k uvicorn.workers.UvicornWorker -b 0.0.0.0:8000
```

## API Documentation

Interactive API documentation available at:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## Testing

### Create a Team (via psql)
```sql
INSERT INTO teams (name, slug, settings)
VALUES ('Test Team', 'test-team', '{"max_users": 5}');
```

### Register a User
```bash
curl -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@test-team.com",
    "password": "SecurePass123",
    "full_name": "Admin User",
    "team_id": "<team_uuid_from_above>"
  }'
```

### Login
```bash
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{
    "email": "admin@test-team.com",
    "password": "SecurePass123"
  }'
```

### Create Agent (must set user to admin role first)
```sql
UPDATE users SET role = 'admin' WHERE email = 'admin@test-team.com';
```

```bash
curl -X POST http://localhost:8000/api/agents \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "name": "Test Agent",
    "description": "Test agent for development",
    "webhook_url": "http://podcast-n8n:5678/webhook/test",
    "system_prompt": "You are a helpful assistant.",
    "config": {"model": "gpt-4", "temperature": 0.7}
  }'
```

### Create Chat
```bash
curl -X POST http://localhost:8000/api/chats \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "agent_id": "<agent_uuid_from_above>",
    "title": "Test Chat"
  }'
```

### Send Message (Streaming)
```bash
curl -X POST http://localhost:8000/api/chats/<chat_uuid>/messages \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -b cookies.txt \
  -N \
  -d '{
    "content": "Hello, how are you?"
  }'
```

## Troubleshooting

### Issue: "Team not found" during registration
- Make sure to create a team first using psql
- Verify team UUID is correct

### Issue: "Admin privileges required" for agent creation
- Update user role to 'admin' using psql:
  ```sql
  UPDATE users SET role = 'admin' WHERE email = 'user@example.com';
  ```

### Issue: SSE stream not working
- Check that `Accept: text/event-stream` header is set
- Verify nginx configuration doesn't buffer responses:
  ```nginx
  proxy_buffering off;
  proxy_cache off;
  proxy_set_header Connection '';
  proxy_http_version 1.1;
  chunked_transfer_encoding off;
  ```

### Issue: n8n webhook not receiving requests
- Verify webhook URL is accessible from backend container
- Check bearer token if authentication is enabled
- Test webhook directly with curl

## Production Deployment

1. **Use HTTPS** (required for secure cookies)
2. **Set environment to production**:
   ```env
   ENVIRONMENT=production
   ```
3. **Use strong JWT secret**:
   ```bash
   openssl rand -hex 32
   ```
4. **Configure reverse proxy** (nginx/caddy)
5. **Set up database backups**
6. **Enable logging and monitoring**
7. **Use gunicorn with multiple workers**
8. **Set up rate limiting** (Redis-based)
9. **Configure CORS origins** properly
10. **Use database connection pooling**

## Next Steps

- [ ] Implement token blacklist for logout
- [ ] Add Redis-based rate limiting
- [ ] Add message search (using JSONB GIN index)
- [ ] Add file upload support for messages
- [ ] Add typing indicators
- [ ] Add read receipts
- [ ] Add push notifications
- [ ] Add analytics and usage tracking
- [ ] Add export chat functionality
- [ ] Add shared chats between team members
