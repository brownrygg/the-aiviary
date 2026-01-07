# FastAPI Multi-Tenant Chat with n8n Streaming

A production-ready FastAPI backend for multi-tenant AI chat with n8n webhook integration and Server-Sent Events (SSE) streaming.

## Quick Start

```bash
# 1. Install dependencies
cd /home/rikk/backend
pip install -r requirements.txt

# 2. Set up database
psql -U user -d database -f /home/rikk/schema.sql

# 3. Configure environment
cp .env.example .env
# Edit .env with your settings

# 4. Run the server
python main.py

# 5. Run interactive tests
./test_streaming.sh
```

## What's New

This implementation adds complete chat and agent management with streaming support:

### New Features
- **Agent Management**: CRUD operations for AI agents backed by n8n webhooks
- **Chat System**: Multi-user conversations with JSONB message storage
- **SSE Streaming**: Real-time message streaming from n8n to frontend
- **Team Isolation**: Multi-tenant architecture with team-based access control
- **Role-Based Access**: Admin and user roles with appropriate permissions

### New Endpoints

**Agents** (requires authentication, some require admin):
- `GET /api/agents` - List all agents for team
- `POST /api/agents` - Create new agent (admin only)
- `GET /api/agents/{id}` - Get agent details
- `PUT /api/agents/{id}` - Update agent (admin only)
- `DELETE /api/agents/{id}` - Delete agent (admin only)
- `POST /api/agents/{id}/avatar` - Upload agent avatar (admin only)

**Chats** (requires authentication):
- `GET /api/chats` - List user's chats
- `POST /api/chats` - Create new chat
- `GET /api/chats/{id}` - Get chat with messages
- `PUT /api/chats/{id}` - Update chat metadata
- `DELETE /api/chats/{id}` - Delete chat
- `POST /api/chats/{id}/messages` - **Send message and stream response (SSE)**

## Architecture

```
Frontend → FastAPI → n8n Webhook → LLM
           ↓
      PostgreSQL (JSONB messages)
```

The system uses:
- **JWT authentication** with httpOnly cookies
- **Multi-tenant isolation** via team_id
- **JSONB message storage** for simplicity (Open WebUI pattern)
- **Server-Sent Events** for real-time streaming
- **aiohttp** for async n8n webhook requests

## Streaming Flow

1. **User sends message** via POST to `/api/chats/{id}/messages`
2. **Backend validates** authentication and ownership
3. **Backend saves** user message to database (JSONB array)
4. **Backend calls** n8n webhook with full chat history
5. **n8n processes** request (calls LLM, etc.)
6. **n8n streams** response back via SSE
7. **Backend streams** to frontend via SSE
8. **Backend saves** assistant response to database
9. **Frontend displays** response in real-time

## Files Structure

### New Files
- `streaming.py` - N8nStreamer helper class for webhook integration
- `routers/agents.py` - Agent CRUD endpoints
- `routers/chats.py` - Chat CRUD + streaming endpoint
- `STREAMING_API_GUIDE.md` - Comprehensive API documentation
- `IMPLEMENTATION_SUMMARY.md` - Implementation overview
- `ARCHITECTURE.md` - System architecture diagrams
- `test_streaming.sh` - Interactive testing script

### Modified Files
- `models.py` - Updated to UUID-based tables with Team, Agent, Chat
- `schemas.py` - Added Pydantic models for Agent, Chat, Message
- `auth.py` - Updated for UUID-based User model
- `routers/auth.py` - Updated for team-based registration
- `main.py` - Registered new routers
- `requirements.txt` - Added aiohttp dependency

## Quick Example

### Create an Agent

```bash
curl -X POST http://localhost:8000/api/agents \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "name": "Support Bot",
    "description": "Customer support assistant",
    "webhook_url": "http://podcast-n8n:5678/webhook/support",
    "system_prompt": "You are a helpful customer support assistant."
  }'
```

### Create a Chat

```bash
curl -X POST http://localhost:8000/api/chats \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "agent_id": "550e8400-e29b-41d4-a716-446655440002",
    "title": "Support Request"
  }'
```

### Send Message (Streaming)

```bash
curl -X POST http://localhost:8000/api/chats/550e8400-.../messages \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -b cookies.txt \
  -N \
  -d '{"content": "Hello, I need help"}'
```

**Output (SSE):**
```
data: {"type":"status","data":{"description":"Sending request to n8n...","level":"info"}}

data: {"type":"message","data":{"content":"Hi"}}

data: {"type":"message","data":{"content":" there!"}}

data: {"type":"message","data":{"content":" How can I help?"}}

data: {"type":"done","data":{"message":"Stream completed"}}
```

## Frontend Integration

### JavaScript

```javascript
async function sendMessage(chatId, content) {
  const response = await fetch(`/api/chats/${chatId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
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
        const event = JSON.parse(line.slice(6));

        if (event.type === 'message') {
          // Append chunk to UI
          appendToChat(event.data.content);
        } else if (event.type === 'done') {
          // Stream completed
          break;
        }
      }
    }
  }
}
```

### React

```jsx
const [response, setResponse] = useState('');

useEffect(() => {
  const sendMessage = async () => {
    const res = await fetch(`/api/chats/${chatId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ content: message })
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
          const event = JSON.parse(line.slice(6));
          if (event.type === 'message') {
            setResponse(prev => prev + event.data.content);
          }
        }
      }
    }
  };

  sendMessage();
}, [chatId, message]);
```

## n8n Webhook Setup

Your n8n workflow should accept this format:

**Request:**
```json
{
  "messages": [
    {"role": "user", "content": "Hello", "timestamp": "2025-01-01T10:00:00Z"},
    {"role": "assistant", "content": "Hi!", "timestamp": "2025-01-01T10:00:05Z"}
  ],
  "system_prompt": "You are a helpful assistant.",
  "config": {
    "model": "gpt-4",
    "temperature": 0.7
  }
}
```

**Response (SSE):**
```
data: {"content": "Hi"}

data: {"content": " there!"}

data: [DONE]
```

**Or (JSON):**
```json
{
  "content": "Hi there! How can I help you?"
}
```

## Security

- **JWT tokens** in httpOnly cookies (XSS protection)
- **SameSite=Strict** (CSRF protection)
- **Multi-tenant isolation** via team_id
- **Role-based access control** (user/admin)
- **Rate limiting** on login (5/min/IP)
- **Password hashing** with bcrypt (12 rounds)
- **Input validation** via Pydantic
- **UUID primary keys** (no enumeration)

## Testing

Run the interactive test script:

```bash
./test_streaming.sh
```

This will guide you through:
1. Creating a team (via psql)
2. Registering a user
3. Setting admin role
4. Creating an agent
5. Creating a chat
6. Sending a message with streaming

## Documentation

- **API Guide**: `STREAMING_API_GUIDE.md` - Comprehensive API documentation
- **Implementation**: `IMPLEMENTATION_SUMMARY.md` - What was built
- **Architecture**: `ARCHITECTURE.md` - System diagrams and flows
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## Database Schema

Key tables:
- `teams` - Multi-tenant organizations
- `users` - Authentication, linked to team
- `agents` - n8n webhook configurations
- `chats` - Conversations with JSONB message arrays
- `error_logs` - Application error tracking

Messages stored as JSONB:
```json
{
  "messages": [
    {
      "role": "user",
      "content": "Hello",
      "timestamp": "2025-01-01T10:00:00Z"
    },
    {
      "role": "assistant",
      "content": "Hi there!",
      "timestamp": "2025-01-01T10:00:05Z"
    }
  ]
}
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

Generate JWT secret:
```bash
openssl rand -hex 32
```

## Production Deployment

1. **Use HTTPS** (required for secure cookies)
2. **Set ENVIRONMENT=production** in .env
3. **Use strong JWT secret** (openssl rand -hex 32)
4. **Configure reverse proxy** (nginx/caddy) with SSE support:
   ```nginx
   proxy_buffering off;
   proxy_cache off;
   proxy_set_header Connection '';
   proxy_http_version 1.1;
   chunked_transfer_encoding off;
   ```
5. **Use gunicorn** with multiple workers:
   ```bash
   gunicorn main:app -w 4 -k uvicorn.workers.UvicornWorker
   ```
6. **Set up database backups**
7. **Enable monitoring and logging**
8. **Configure CORS origins** properly
9. **Use Redis** for distributed rate limiting

## Troubleshooting

### "Team not found" during registration
Create a team first:
```sql
INSERT INTO teams (name, slug) VALUES ('Test Team', 'test-team');
```

### "Admin privileges required"
Set user role to admin:
```sql
UPDATE users SET role = 'admin' WHERE email = 'user@example.com';
```

### SSE not streaming
- Check `Accept: text/event-stream` header
- Verify nginx doesn't buffer (set `proxy_buffering off`)
- Check browser console for errors

### n8n webhook not responding
- Verify webhook URL is accessible
- Test directly with curl
- Check bearer token if auth is enabled

## Development

```bash
# Install dependencies
pip install -r requirements.txt

# Run database migrations (create tables)
psql -U user -d database -f /home/rikk/schema.sql

# Run development server
python main.py

# Or use uvicorn directly
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## Contributing

When adding new features:
1. Follow existing code structure
2. Add Pydantic models to `schemas.py`
3. Add database models to `models.py`
4. Create endpoints in appropriate router
5. Update documentation
6. Add tests

## License

[Your License Here]

## Support

- Documentation: See `/home/rikk/backend/STREAMING_API_GUIDE.md`
- API Docs: http://localhost:8000/docs
- Architecture: See `/home/rikk/backend/ARCHITECTURE.md`

## Credits

- Built with FastAPI, SQLAlchemy, and PostgreSQL
- Inspired by Open WebUI's JSONB message storage pattern
- SSE streaming implementation for real-time AI responses
