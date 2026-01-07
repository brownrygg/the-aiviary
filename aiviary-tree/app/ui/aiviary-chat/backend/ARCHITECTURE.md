# Chat Streaming Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Frontend (React/Vue/etc)                     │
│  - Sends HTTP requests with cookies                                 │
│  - Receives Server-Sent Events (SSE) for streaming                  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTP/HTTPS
                                    │ Cookies: access_token
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         FastAPI Backend                              │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ main.py - Application Entry Point                          │   │
│  │  - CORS middleware                                          │   │
│  │  - Security headers                                         │   │
│  │  - Request logging                                          │   │
│  │  - Error handlers                                           │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                    │                                 │
│                    ┌───────────────┴───────────────┐                │
│                    │                                 │                │
│                    ▼                                 ▼                │
│  ┌──────────────────────────┐      ┌──────────────────────────┐    │
│  │ routers/auth.py          │      │ routers/agents.py        │    │
│  │ - Register (team-based)  │      │ - List agents            │    │
│  │ - Login (JWT cookies)    │      │ - Create agent (admin)   │    │
│  │ - Logout                 │      │ - Update agent (admin)   │    │
│  │ - Get current user       │      │ - Delete agent (admin)   │    │
│  │ - Refresh token          │      │ - Upload avatar          │    │
│  └──────────────────────────┘      └──────────────────────────┘    │
│                                                                       │
│                    ┌──────────────────────────────────────┐         │
│                    │ routers/chats.py                     │         │
│                    │ - List chats                         │         │
│                    │ - Create chat                        │         │
│                    │ - Update/Delete chat                 │         │
│                    │ ▼                                    │         │
│                    │ POST /chats/{id}/messages (SSE)      │         │
│                    │   1. Validate user owns chat         │         │
│                    │   2. Add user message to DB          │         │
│                    │   3. Call N8nStreamer                │         │
│                    │   4. Stream response via SSE         │         │
│                    │   5. Save assistant message to DB    │         │
│                    └──────────────────────────────────────┘         │
│                                    │                                 │
│                                    │ Uses                            │
│                                    ▼                                 │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ streaming.py - N8nStreamer                                  │   │
│  │  - async HTTP client (aiohttp)                              │   │
│  │  - Bearer token authentication                              │   │
│  │  - Handles SSE and JSON responses                           │   │
│  │  - Event emitter for status updates                         │   │
│  │  - Error handling and timeouts                              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                    │                                 │
│                    ┌───────────────┴───────────────┐                │
│                    │                                 │                │
│                    ▼                                 ▼                │
│  ┌──────────────────────────┐      ┌──────────────────────────┐    │
│  │ auth.py                  │      │ models.py                │    │
│  │ - JWT creation/decode    │      │ - Team (UUID)            │    │
│  │ - Password hashing       │      │ - User (UUID, team_id)   │    │
│  │ - Cookie settings        │      │ - Agent (UUID, team_id)  │    │
│  │ - get_current_user       │      │ - Chat (UUID, JSONB)     │    │
│  └──────────────────────────┘      └──────────────────────────┘    │
│                                                │                     │
│                                                ▼                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ database.py                                                 │   │
│  │  - AsyncSession factory                                     │   │
│  │  - Connection pooling                                       │   │
│  │  - PostgreSQL + asyncpg                                     │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                                 │
                    ▼                                 ▼
┌──────────────────────────┐      ┌──────────────────────────┐
│ PostgreSQL Database      │      │ n8n Workflow             │
│  - teams                 │      │  - Webhook trigger       │
│  - users                 │      │  - LLM node (OpenAI)     │
│  - agents                │      │  - Response streaming    │
│  - chats (JSONB msgs)    │      │  - Bearer auth           │
│  - error_logs            │      └──────────────────────────┘
└──────────────────────────┘
```

## Request Flow: Send Message

```
1. Frontend
   │
   │ POST /api/chats/{chat_id}/messages
   │ Cookie: access_token=<jwt>
   │ Body: {"content": "Hello"}
   │
   ▼

2. FastAPI - chats.py::send_message()
   │
   │ ├─> Validate JWT (auth.py::get_current_active_user)
   │ │   └─> Decode JWT → Get user_id → Query DB
   │ │
   │ ├─> Verify chat ownership
   │ │   └─> Query: SELECT * FROM chats WHERE id = ? AND user_id = ?
   │ │
   │ ├─> Get agent config
   │ │   └─> Query: SELECT * FROM agents WHERE id = chat.agent_id
   │ │
   │ ├─> Add user message to chat.messages JSONB array
   │ │   └─> UPDATE chats SET messages = messages || ?
   │ │
   │ └─> Create N8nStreamer instance
   │
   ▼

3. streaming.py::N8nStreamer.stream_response()
   │
   │ ├─> Build request payload
   │ │   {
   │ │     "messages": [...chat history...],
   │ │     "system_prompt": "You are...",
   │ │     "config": {"model": "gpt-4"}
   │ │   }
   │ │
   │ ├─> Send POST to n8n webhook
   │ │   Headers: Authorization: Bearer <webhook_token>
   │ │
   │ └─> Stream response chunks
   │
   ▼

4. n8n Workflow
   │
   │ ├─> Receive webhook POST
   │ ├─> Extract messages + config
   │ ├─> Call OpenAI/Anthropic/etc
   │ ├─> Stream response back
   │ │   Format: data: {"content": "chunk"}\n\n
   │ └─> Return: data: [DONE]\n\n
   │
   ▼

5. streaming.py (continued)
   │
   │ ├─> Parse SSE stream
   │ ├─> Extract content from each chunk
   │ ├─> Yield chunks to chats.py
   │ └─> Emit status updates
   │
   ▼

6. chats.py::event_generator()
   │
   │ ├─> Receive chunks from N8nStreamer
   │ ├─> Accumulate full response
   │ ├─> Format as SSE events
   │ │   data: {"type":"message","data":{"content":"chunk"}}\n\n
   │ │
   │ ├─> Save complete response to DB
   │ │   └─> UPDATE chats SET messages = messages || ?
   │ │
   │ └─> Send done event
   │     data: {"type":"done","data":{"message":"Stream completed"}}\n\n
   │
   ▼

7. Frontend
   │
   │ ├─> Receive SSE events via ReadableStream
   │ ├─> Parse "data: " lines
   │ ├─> Extract JSON from each event
   │ ├─> Append message chunks to UI
   │ └─> Show completion status
```

## Database Schema Relationships

```
┌────────────┐
│   teams    │
│  (UUID)    │
└────┬───────┘
     │
     │ 1:N
     │
     ├─────────────────┬─────────────────┬────────────────
     │                 │                 │
     ▼                 ▼                 ▼
┌─────────┐      ┌─────────┐      ┌─────────┐
│  users  │      │ agents  │      │  chats  │
│ (UUID)  │      │ (UUID)  │      │ (UUID)  │
└────┬────┘      └────┬────┘      └────┬────┘
     │                │                │
     │                │                │
     │ created_by     │ agent_id       │ user_id
     └────────────────┼────────────────┘
                      │
                      │ Messages stored as JSONB:
                      │ [
                      │   {
                      │     "role": "user",
                      │     "content": "...",
                      │     "timestamp": "..."
                      │   },
                      │   ...
                      │ ]
```

## Message Format in Database

```json
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
      "timestamp": "2025-01-01T10:00:00Z"
    },
    {
      "role": "assistant",
      "content": "Hi! How can I assist you today?",
      "timestamp": "2025-01-01T10:00:05Z"
    },
    {
      "role": "user",
      "content": "I can't login to my account",
      "timestamp": "2025-01-01T10:01:00Z"
    },
    {
      "role": "assistant",
      "content": "Let me help you with that...",
      "timestamp": "2025-01-01T10:01:10Z"
    }
  ],
  "metadata": {
    "tags": ["support", "login-issue"],
    "priority": "high"
  },
  "is_archived": false,
  "created_at": "2025-01-01T10:00:00Z",
  "updated_at": "2025-01-01T10:01:10Z"
}
```

## SSE Event Format

```
Event stream sent from FastAPI to frontend:

data: {"type":"status","data":{"description":"Sending request to n8n webhook...","level":"info","done":false}}

data: {"type":"message","data":{"content":"Hi"}}

data: {"type":"message","data":{"content":" there!"}}

data: {"type":"message","data":{"content":" How"}}

data: {"type":"message","data":{"content":" can"}}

data: {"type":"message","data":{"content":" I"}}

data: {"type":"message","data":{"content":" help"}}

data: {"type":"message","data":{"content":" you"}}

data: {"type":"message","data":{"content":"?"}}

data: {"type":"status","data":{"description":"Stream completed","level":"info","done":true}}

data: {"type":"done","data":{"message":"Stream completed"}}

```

## Authentication Flow

```
1. User Registration
   POST /api/auth/register
   {
     "email": "user@example.com",
     "password": "SecurePass123",
     "team_id": "550e8400-..."
   }
   │
   ├─> Validate team exists and is active
   ├─> Check email not already registered in team
   ├─> Hash password with bcrypt (12 rounds)
   ├─> Create user record
   └─> Return user info (no password)

2. User Login
   POST /api/auth/login
   {
     "email": "user@example.com",
     "password": "SecurePass123"
   }
   │
   ├─> Authenticate (constant-time comparison)
   ├─> Generate access token (1 hour expiry)
   ├─> Generate refresh token (7 day expiry)
   ├─> Set httpOnly cookies
   │   - access_token
   │   - refresh_token
   │   - Secure flag (HTTPS only in production)
   │   - SameSite=Strict (CSRF protection)
   └─> Return success message

3. Authenticated Request
   GET /api/chats
   Cookie: access_token=<jwt>
   │
   ├─> Extract token from cookie
   ├─> Decode and validate JWT
   │   - Check signature
   │   - Check expiration
   │   - Extract user_id
   ├─> Query user from database
   ├─> Verify user is active
   └─> Process request with user context

4. Token Refresh
   POST /api/auth/refresh
   Cookie: refresh_token=<jwt>
   │
   ├─> Validate refresh token
   ├─> Generate new access token
   ├─> Generate new refresh token (rotation)
   ├─> Set new cookies
   └─> Return success message
```

## Security Layers

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Transport Security (HTTPS)                               │
│    - TLS encryption                                         │
│    - Certificate validation                                 │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. CORS & Security Headers                                  │
│    - X-Content-Type-Options: nosniff                        │
│    - X-Frame-Options: DENY                                  │
│    - X-XSS-Protection: 1; mode=block                        │
│    - Strict-Transport-Security (HSTS)                       │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Rate Limiting                                            │
│    - Login: 5 attempts/minute/IP                            │
│    - In-memory (dev) / Redis (production)                   │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. JWT Authentication                                       │
│    - httpOnly cookies (XSS protection)                      │
│    - SameSite=Strict (CSRF protection)                      │
│    - Secure flag (HTTPS only)                               │
│    - Short expiry (1 hour access, 7 day refresh)            │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Authorization                                            │
│    - Role-based access control (user/admin)                 │
│    - Resource ownership verification                        │
│    - Team-based isolation                                   │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. Input Validation                                         │
│    - Pydantic models                                        │
│    - UUID format validation                                 │
│    - File type and size limits                              │
│    - SQL injection protection (parameterized queries)       │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. Database Security                                        │
│    - Password hashing (bcrypt, 12 rounds)                   │
│    - Encrypted webhook tokens (application layer)           │
│    - Connection pooling                                     │
│    - Prepared statements                                    │
└─────────────────────────────────────────────────────────────┘
```

## Deployment Architecture

```
┌────────────────────────────────────────────────────────────┐
│                     Internet                               │
└────────────────┬───────────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────┐
│              Cloudflare / CDN                              │
│  - DDoS protection                                         │
│  - SSL/TLS termination                                     │
│  - Rate limiting                                           │
└────────────────┬───────────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────┐
│              Nginx / Reverse Proxy                         │
│  - SSL termination                                         │
│  - Load balancing                                          │
│  - Gzip compression                                        │
│  - Static file serving                                     │
│  - Disable buffering for SSE:                              │
│    proxy_buffering off;                                    │
│    proxy_cache off;                                        │
└────────────────┬───────────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────┐
│         Gunicorn + Uvicorn Workers                         │
│  - gunicorn main:app                                       │
│    -w 4                                                    │
│    -k uvicorn.workers.UvicornWorker                        │
│    -b 0.0.0.0:8000                                         │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ FastAPI Application (main.py)                        │ │
│  │  - Routers (auth, agents, chats)                     │ │
│  │  - Database sessions                                 │ │
│  │  - N8n streaming                                     │ │
│  └──────────────────────────────────────────────────────┘ │
└────────────────┬───────────────────────────────────────────┘
                 │
     ┌───────────┴────────────┐
     │                        │
     ▼                        ▼
┌──────────────┐      ┌──────────────┐
│ PostgreSQL   │      │ n8n Workflow │
│  - pgvector  │      │  - Webhook   │
│  - Connection│      │  - LLM node  │
│    pooling   │      │  - Streaming │
└──────────────┘      └──────────────┘
```

## File Structure

```
/home/rikk/backend/
│
├── main.py                      # Application entry point
│   ├── FastAPI app initialization
│   ├── CORS configuration
│   ├── Security headers middleware
│   ├── Request logging middleware
│   ├── Exception handlers
│   └── Router registration
│
├── models.py                    # SQLAlchemy ORM models
│   ├── Team (multi-tenancy)
│   ├── User (authentication)
│   ├── Agent (n8n webhooks)
│   ├── Chat (JSONB messages)
│   └── ErrorLog (debugging)
│
├── schemas.py                   # Pydantic validation models
│   ├── UserRegister, UserLogin, UserResponse
│   ├── AgentCreate, AgentUpdate, AgentResponse
│   ├── ChatCreate, ChatUpdate, ChatResponse
│   └── SendMessageRequest, MessageContent
│
├── auth.py                      # Authentication utilities
│   ├── JWT token creation/validation
│   ├── Password hashing (bcrypt)
│   ├── Cookie settings
│   ├── get_current_user dependencies
│   └── authenticate_user
│
├── database.py                  # Database configuration
│   ├── Async engine setup
│   ├── Session factory
│   ├── get_db dependency
│   └── init_db/drop_db
│
├── streaming.py                 # n8n webhook streaming
│   └── N8nStreamer class
│       ├── stream_response (SSE handling)
│       ├── get_response (non-streaming)
│       └── emit_status (event emitter)
│
├── routers/
│   ├── __init__.py
│   │
│   ├── auth.py                  # Authentication endpoints
│   │   ├── POST /register
│   │   ├── POST /login
│   │   ├── POST /logout
│   │   ├── GET /me
│   │   └── POST /refresh
│   │
│   ├── agents.py                # Agent management
│   │   ├── GET /agents
│   │   ├── POST /agents
│   │   ├── GET /agents/{id}
│   │   ├── PUT /agents/{id}
│   │   ├── DELETE /agents/{id}
│   │   └── POST /agents/{id}/avatar
│   │
│   └── chats.py                 # Chat & messaging
│       ├── GET /chats
│       ├── POST /chats
│       ├── GET /chats/{id}
│       ├── PUT /chats/{id}
│       ├── DELETE /chats/{id}
│       └── POST /chats/{id}/messages (SSE STREAMING)
│
├── requirements.txt             # Python dependencies
├── .env.example                 # Environment variables template
├── .gitignore                   # Git ignore patterns
│
├── STREAMING_API_GUIDE.md       # Comprehensive API documentation
├── IMPLEMENTATION_SUMMARY.md    # Implementation overview
├── ARCHITECTURE.md              # This file
└── test_streaming.sh            # Interactive test script
```

## Key Technologies

- **FastAPI**: Modern async web framework
- **SQLAlchemy**: ORM with async support
- **asyncpg**: PostgreSQL async driver
- **aiohttp**: Async HTTP client for n8n
- **python-jose**: JWT encoding/decoding
- **passlib + bcrypt**: Password hashing
- **Pydantic**: Data validation
- **Uvicorn**: ASGI server
- **PostgreSQL**: Database with JSONB support
- **Server-Sent Events (SSE)**: One-way streaming

## Performance Considerations

- **Connection pooling**: 10 base + 20 overflow
- **Async I/O**: Non-blocking database and HTTP
- **JSONB indexing**: GIN index for message search
- **Prepared statements**: SQL injection protection + performance
- **Cookie-based auth**: No database lookup on every request
- **Streaming**: Low memory footprint for long responses
- **Lazy loading**: Paginated chat list

## Monitoring & Logging

```
Application Logs:
  - Request/response logging (no sensitive data)
  - Error logging with stack traces
  - Authentication attempts
  - Rate limit violations
  - Agent/chat CRUD operations

Database:
  - error_logs table for application errors
  - Structured logging with team/user/agent/chat IDs
  - Severity levels (info, warning, error, critical)

Metrics to Track:
  - Request latency (p50, p95, p99)
  - Error rate (4xx, 5xx)
  - Authentication success/failure rate
  - SSE connection duration
  - n8n webhook response time
  - Database query performance
  - Active chat sessions
  - Messages per second
```
