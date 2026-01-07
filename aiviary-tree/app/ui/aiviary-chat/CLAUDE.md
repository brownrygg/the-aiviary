# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agent Chat UI is a multi-tenant chat application that routes AI conversations through n8n webhooks. Users authenticate, select agents (which point to n8n workflows), and receive streaming responses via Server-Sent Events.

**Key Concept**: This is NOT a direct LLM integration. n8n workflows handle all AI logic. The chat app is a secure, multi-tenant frontend that streams n8n responses.

## Development Commands

### Backend (FastAPI)

```bash
# Setup (first time)
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Start development server
source venv/bin/activate
python main.py
# Runs on http://localhost:9000 (or PORT from .env)

# Database operations
python create_superuser.py  # Create admin user
# Database auto-initializes on first run via lifespan manager
```

### Frontend (React + Vite)

```bash
# Setup (first time)
cd frontend
npm install

# Start dev server
npm run dev
# Runs on http://localhost:3001

# Build for production
npm run build
```

### Running Both Servers

Use two terminals or the provided script:
```bash
./start-dev.sh
```

## Critical Architecture Concepts

### Multi-Tenancy Pattern

**Every query MUST filter by team_id**. Data isolation is enforced at the application layer:

```python
# CORRECT - filters by team
chats = await db.execute(
    select(Chat).where(
        and_(
            Chat.team_id == current_user.team_id,
            Chat.user_id == current_user.id
        )
    )
)

# WRONG - no team filter, exposes other teams' data
chats = await db.execute(
    select(Chat).where(Chat.user_id == current_user.id)
)
```

All routers use `Depends(get_current_active_user)` which provides the authenticated user with their team_id.

### Router-Based Architecture

**The application uses modular routers** (not all endpoints in main.py):

```
backend/
├── main.py              # FastAPI app, middleware, lifespan
├── routers/
│   ├── auth.py         # /api/auth/* endpoints
│   ├── agents.py       # /api/agents/* endpoints
│   └── chats.py        # /api/chats/* and /api/chat/* endpoints
```

All routers are included in `main.py` via:
```python
from routers import auth, agents, chats
app.include_router(auth.router)
app.include_router(agents.router)
app.include_router(chats.router)
app.include_router(chats.legacy_router)  # For frontend compatibility
```

### n8n Streaming Integration

**The workflow webhook must be configured for streaming mode** in n8n. The backend expects:

1. **Request format** (sent to n8n webhook):
```json
{
  "messages": [
    {"role": "user", "content": "...", "timestamp": "..."},
    {"role": "assistant", "content": "...", "timestamp": "..."}
  ],
  "system_prompt": "You are a helpful assistant",
  "config": {}  // From agent.config JSONB
}
```

2. **Response format** (from n8n):
   - **Streaming**: Concatenated JSON objects (NOT newline-delimited, NOT SSE format)
   - Parser uses **brace matching** to extract complete JSON objects from buffer
   - Looks for fields: `text`, `content`, `output`, `message`, `delta`, `data`, `response`, `result`
   - See `streaming.py::stream_response()` for the JSON parsing logic

3. **Example n8n streaming response**:
```
{"text": "Hello"}{"text": " there"}{"text": "!"}
```

### Authentication Flow

JWT tokens are stored in **httpOnly cookies** (not localStorage) to prevent XSS:

```python
# Login sets cookies
response.set_cookie(
    key="access_token",
    value=access_token,
    httponly=True,  # JavaScript cannot access
    samesite="strict",  # CSRF protection
    secure=False,  # Set to True in production with HTTPS
)
```

Frontend never sees the token. Axios automatically includes cookies:
```javascript
const apiClient = axios.create({
  baseURL: '/api',
  withCredentials: true,  # Send cookies with requests
});
```

### Database Schema Patterns

**JSONB Usage**: Flexible schemas without migrations

```python
# Chat.messages is JSONB array
chat.messages = [
    {"role": "user", "content": "Hello", "timestamp": "2024-01-01T12:00:00"},
    {"role": "assistant", "content": "Hi!", "timestamp": "2024-01-01T12:00:01"}
]

# Agent.config is JSONB object
agent.config = {"model": "gpt-4", "temperature": 0.7, "max_tokens": 2000}
```

**Why JSONB over separate tables**: Matches OpenWebUI pattern, allows schema evolution, single query retrieval.

**Session Management for Streaming**:
```python
# IMPORTANT: Database session closes before streaming completes
# Must create new session to save assistant response

async def event_generator():
    # ... streaming happens ...

    # Wrong: session already closed
    # chat.messages.append(assistant_message)

    # Correct: new session
    async with AsyncSessionLocal() as new_db:
        result = await new_db.execute(
            select(Chat).where(Chat.id == UUID(chat_id_str))
        )
        db_chat = result.scalar_one()
        db_chat.messages.append(assistant_message)
        await new_db.commit()
```

### SSE Response Format

Frontend expects Server-Sent Events in this format:

```
data: {"type": "status", "data": {"description": "Processing..."}}\n\n
data: {"type": "message", "data": {"content": "Hello "}}\n\n
data: {"type": "message", "data": {"content": "world!"}}\n\n
data: {"type": "done", "data": {}}\n\n
```

Event types:
- `status`: Show loading indicators (e.g., "Sending request to n8n...")
- `message`: Append content to streaming response
- `done`: Mark completion
- `error`: Show error message

### Frontend Component Data Flow

```
App.jsx (router)
  └── ProtectedRoute (checks /api/auth/me)
       └── ChatLayout
            ├── AgentSelector
            │    ├── Fetches agents via /api/agents
            │    └── Calls handleAgentSelect(id, name)
            │
            └── ChatArea (receives agentId, agentName)
                 ├── Fetches history via /api/chat/{agentId}/history
                 ├── Sends messages via POST /api/chat/{agentId}/message
                 ├── Renders markdown with react-markdown
                 └── Parses SSE stream with event handlers:
                      - onChunk: Append to message
                      - onStatus: Update status indicator below agent name
                      - onDone: Clear status, mark complete
                      - onError: Show error
```

**Important**: AgentSelector must pass both `id` AND `name` to ChatLayout so the agent name appears above messages.

## Common Gotchas

### 1. Forward References in Pydantic

**Problem**: `NameError: name 'Optional' is not defined` with Pydantic v2

**Solution**: Add to top of router files:
```python
from __future__ import annotations
```

This enables string-based type annotations which Pydantic v2 requires.

### 2. UUID Serialization

**Problem**: `ValidationError: UUID object is not JSON serializable`

**Solution**: Add validators to response schemas:
```python
class AgentResponse(BaseModel):
    id: str
    team_id: str
    created_by: str

    @validator('id', 'team_id', 'created_by', pre=True)
    def convert_uuid_to_str(cls, v):
        if v is not None and hasattr(v, '__str__'):
            return str(v)
        return v
```

### 3. SQLAlchemy 2.0 Text Expressions

**Problem**: `Textual SQL expression should be explicitly declared as text()`

**Solution**:
```python
from sqlalchemy import text

# Wrong
await db.execute("SELECT 1")

# Correct
await db.execute(text("SELECT 1"))
```

### 4. Event Emitter in Streaming

**Problem**: Async generators can't be awaited

**Solution**: Use a list to accumulate events, then yield them:
```python
status_events = []

async def status_emitter(event: dict):
    status_events.append(event)

async for chunk in streamer.stream_response(..., event_emitter=status_emitter):
    # Emit accumulated status events
    for status_event in status_events:
        yield f"data: {json.dumps(status_event)}\n\n"
    status_events.clear()

    # Emit chunk
    yield f"data: {json.dumps({'type': 'message', 'data': {'content': chunk}})}\n\n"
```

### 5. n8n Response Parsing

**Problem**: "Extra data: line 2 column 1 (char 153)" - n8n sends concatenated JSON

**Solution**: The backend now handles this correctly with brace-matching parser in `streaming.py`. n8n's streaming mode sends:
```json
{"text":"chunk1"}{"text":"chunk2"}{"text":"chunk3"}
```

Not SSE format (`data: ...\n\n`), not newline-delimited JSON. The parser extracts complete objects by counting braces.

## File References

When making changes, be aware of these dependencies:

- **auth.py** → Provides `get_current_active_user` used by all routers
- **schemas.py** → Referenced by routers for request/response validation
- **models.py** → Imported by database.py for table creation
- **streaming.py** → Used only by routers/chats.py for n8n integration
- **main.py** → Imports all routers, sets up middleware, defines lifespan events
- **routers/*.py** → All have `from __future__ import annotations` for Pydantic v2

## Environment Configuration

Critical `.env` variables for backend:

```env
DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5433/agent_chat_db
JWT_SECRET_KEY=<hex-string>  # Generate with: openssl rand -hex 32
ENVIRONMENT=development       # Controls secure cookie flag
PORT=9000                     # Backend server port
HOST=0.0.0.0                 # Listen on all interfaces
ALLOWED_ORIGINS=http://localhost:3001  # CORS for frontend
```

Frontend proxy in `vite.config.js`:
```javascript
server: {
  host: '0.0.0.0',  // Network access
  port: 3001,
  proxy: {
    '/api': {
      target: 'http://localhost:9000',  // Must match backend PORT
      changeOrigin: true,
    }
  }
}
```

## Testing n8n Integration

1. Create a workflow in n8n with:
   - **Webhook node**: POST method, **Response Mode = "Using 'Respond to Webhook' Node"**
   - **Processing nodes**: LLM, tools, etc.
   - **Respond to Webhook node**: Configure to stream responses

2. In Admin Panel (`http://localhost:3001/admin`), create agent:
   - Webhook URL: `http://192.168.8.108:5678/webhook/test-agent`
   - System Prompt: Instructions for the LLM
   - Config: Optional JSON like `{"model": "gpt-4", "temperature": 0.7}`

3. Select agent in chat, send message, verify:
   - Backend logs show POST to webhook
   - Frontend shows streaming response with markdown rendering
   - Status updates appear below agent name
   - Message saved to database

## Default Credentials

Test user (created via `create_superuser.py`):
- Email: `test@example.com`
- Password: `Test1234`
- Team: Auto-created test team

## Code Style Notes

- **Async everywhere**: All database operations use `async/await`
- **Type hints**: Use for function signatures (helps with autocomplete)
- **Dependency injection**: Prefer `Depends()` over global state
- **JSONB over migrations**: Extend schemas via config/metadata fields
- **Team isolation**: Always filter by team_id in queries
- **httpOnly cookies**: Never expose tokens to JavaScript
- **Markdown support**: Assistant messages automatically render markdown via `react-markdown`

## Deployment Considerations

- Set `ENVIRONMENT=production` in `.env` for secure cookies
- Use HTTPS in production (secure=True on cookies)
- PostgreSQL connection pooling is configured (pool_size=10, max_overflow=20)
- Frontend build: `npm run build` → serve `dist/` directory
- Backend runs via `python main.py` or use systemd/supervisor
- Ensure reverse proxy has `proxy_buffering off` for SSE streaming

## Quick Reference: Adding a New Feature

1. **Database change**: Update `models.py`, add fields to existing tables (JSONB preferred)
2. **API endpoint**: Add to appropriate router in `routers/`
3. **Schema validation**: Add Pydantic models to `schemas.py`
4. **Frontend component**: Create in `src/components/`
5. **API call**: Add method to `src/api/client.js`
6. **Testing**: Use `/docs` (FastAPI auto-docs) for API testing

## Current State

The application is fully functional with:
- ✅ Working authentication (JWT cookies)
- ✅ Admin panel for managing agents
- ✅ Chat interface with streaming responses
- ✅ Markdown rendering for assistant messages
- ✅ Status indicators during streaming
- ✅ Speaker labels (User / Agent Name)
- ✅ n8n webhook integration with proper JSON parsing
- ✅ Multi-tenant data isolation
- ✅ CORS configured for development

Remember: This app is a chat interface, NOT an LLM service. All AI logic lives in n8n workflows.
