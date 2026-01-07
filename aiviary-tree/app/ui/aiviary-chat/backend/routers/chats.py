from __future__ import annotations

"""
Chat management router - chat CRUD and message streaming endpoints.

Endpoints:
- GET /api/chats - List user's chats
- POST /api/chats - Create new chat
- GET /api/chats/{id} - Get chat with full message history
- PUT /api/chats/{id} - Update chat metadata
- DELETE /api/chats/{id} - Delete chat
- POST /api/chats/{id}/messages - Send message and get streaming response

Security:
- All endpoints require authentication
- Chats are filtered by user_id
- Users can only access their own chats
- Message streaming uses Server-Sent Events (SSE)
"""

import json
import logging
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import and_, desc

from auth import get_current_active_user
from database import get_db
from models import User, Agent, Chat
from schemas import (
    ChatCreate,
    ChatUpdate,
    ChatResponse,
    SendMessageRequest,
    MessageResponse,
)
from streaming import N8nStreamer

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chats", tags=["chats"])

# Legacy router for frontend compatibility (no prefix)
legacy_router = APIRouter(prefix="/api/chat", tags=["chat-legacy"])


# ============================================================================
# Helper Functions
# ============================================================================

async def get_chat_by_id(
    chat_id: str,
    user_id: UUID,
    db: AsyncSession,
) -> Chat:
    """
    Get chat by ID and verify it belongs to the user.

    Args:
        chat_id: Chat UUID
        user_id: User UUID
        db: Database session

    Returns:
        Chat object

    Raises:
        HTTPException: 404 if chat not found or doesn't belong to user
    """
    try:
        chat_uuid = UUID(chat_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid chat ID format"
        )

    result = await db.execute(
        select(Chat).where(
            and_(
                Chat.id == chat_uuid,
                Chat.user_id == user_id
            )
        )
    )
    chat = result.scalar_one_or_none()

    if not chat:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat not found"
        )

    return chat


async def get_agent_by_id(
    agent_id: str,
    team_id: UUID,
    db: AsyncSession,
) -> Agent:
    """
    Get agent by ID and verify it belongs to the team.

    Args:
        agent_id: Agent UUID
        team_id: Team UUID
        db: Database session

    Returns:
        Agent object

    Raises:
        HTTPException: 404 if agent not found or doesn't belong to team
    """
    try:
        agent_uuid = UUID(agent_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid agent ID format"
        )

    result = await db.execute(
        select(Agent).where(
            and_(
                Agent.id == agent_uuid,
                Agent.team_id == team_id,
                Agent.is_active == True
            )
        )
    )
    agent = result.scalar_one_or_none()

    if not agent:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Agent not found or inactive"
        )

    return agent


# ============================================================================
# Chat Endpoints
# ============================================================================

@router.get(
    "",
    response_model=List[ChatResponse],
    summary="List user's chats",
    description="Get all chats for the current user. Excludes archived chats by default.",
)
async def list_chats(
    include_archived: bool = False,
    limit: int = 50,
    offset: int = 0,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> List[Chat]:
    """
    List user's chats.

    Security:
    - Filtered by user_id
    - Only shows non-archived chats by default
    - Paginated results
    """
    query = select(Chat).where(Chat.user_id == current_user.id)

    if not include_archived:
        query = query.where(Chat.is_archived == False)

    query = query.order_by(desc(Chat.updated_at)).limit(limit).offset(offset)

    result = await db.execute(query)
    chats = result.scalars().all()

    logger.info(f"User {current_user.id} listed {len(chats)} chats")

    return chats


@router.post(
    "",
    response_model=ChatResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create new chat",
    description="Create a new chat with an agent.",
)
async def create_chat(
    chat_data: ChatCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> Chat:
    """
    Create new chat.

    Security:
    - Verifies agent exists and belongs to user's team
    - Initializes with empty message array
    """
    # Verify agent exists and belongs to team
    agent = await get_agent_by_id(chat_data.agent_id, current_user.team_id, db)

    # Create chat
    new_chat = Chat(
        team_id=current_user.team_id,
        user_id=current_user.id,
        agent_id=agent.id,
        title=chat_data.title,
        messages=[],
        chat_metadata=chat_data.chat_metadata or {},
        is_archived=False,
    )

    db.add(new_chat)
    await db.commit()
    await db.refresh(new_chat)

    logger.info(f"User {current_user.id} created chat {new_chat.id} with agent {agent.id}")

    return new_chat


@router.get(
    "/{chat_id}",
    response_model=ChatResponse,
    summary="Get chat details",
    description="Get chat with full message history.",
)
async def get_chat(
    chat_id: str,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> Chat:
    """
    Get chat by ID.

    Security:
    - Verifies chat belongs to user
    """
    chat = await get_chat_by_id(chat_id, current_user.id, db)

    logger.info(f"User {current_user.id} retrieved chat {chat.id}")

    return chat


@router.put(
    "/{chat_id}",
    response_model=ChatResponse,
    summary="Update chat",
    description="Update chat metadata (title, archived status, etc).",
)
async def update_chat(
    chat_id: str,
    chat_data: ChatUpdate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> Chat:
    """
    Update chat.

    Security:
    - Verifies chat belongs to user
    - Only updates metadata, not messages
    """
    # Get existing chat
    chat = await get_chat_by_id(chat_id, current_user.id, db)

    # Update fields
    update_data = chat_data.model_dump(exclude_unset=True)

    for field, value in update_data.items():
        setattr(chat, field, value)

    await db.commit()
    await db.refresh(chat)

    logger.info(f"User {current_user.id} updated chat {chat.id}")

    return chat


@router.delete(
    "/{chat_id}",
    response_model=MessageResponse,
    summary="Delete chat",
    description="Delete a chat and all its messages.",
)
async def delete_chat(
    chat_id: str,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """
    Delete chat.

    Security:
    - Verifies chat belongs to user
    - Permanently deletes chat and messages
    """
    # Get existing chat
    chat = await get_chat_by_id(chat_id, current_user.id, db)

    # Delete chat
    await db.delete(chat)
    await db.commit()

    logger.info(f"User {current_user.id} deleted chat {chat.id}")

    return MessageResponse(message="Chat deleted successfully")


# ============================================================================
# Message Streaming Endpoint
# ============================================================================

@router.post(
    "/{chat_id}/messages",
    summary="Send message and stream response",
    description="Send a message to the chat and receive a streaming response from the agent.",
)
async def send_message(
    chat_id: str,
    message_data: SendMessageRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Send message and stream response.

    Security:
    - Verifies chat belongs to user
    - Streams response using Server-Sent Events (SSE)
    - Saves both user message and assistant response to database

    Returns:
        StreamingResponse with Server-Sent Events
    """
    # Get chat and verify ownership
    chat = await get_chat_by_id(chat_id, current_user.id, db)

    # Get agent
    result = await db.execute(
        select(Agent).where(Agent.id == chat.agent_id)
    )
    agent = result.scalar_one_or_none()

    if not agent:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Agent not found"
        )

    if not agent.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Agent is inactive"
        )

    # Add user message to chat history
    user_message = {
        "role": "user",
        "content": message_data.content,
        "timestamp": datetime.utcnow().isoformat()
    }

    # Get current messages from database
    current_messages = chat.messages if chat.messages else []
    current_messages.append(user_message)

    # Update chat with user message
    chat.messages = current_messages
    await db.commit()

    logger.info(f"User {current_user.id} sent message to chat {chat.id}")

    # Create n8n streamer
    streamer = N8nStreamer(
        webhook_url=agent.webhook_url,
        bearer_token=agent.webhook_token,
        timeout=300,
    )

    # Store chat_id for later database operations
    chat_id_str = str(chat.id)

    # Stream response
    async def event_generator():
        """
        Generate Server-Sent Events for streaming response.

        SSE format:
        data: <json>\n\n

        Events:
        - status: Status updates
        - message: Message chunks
        - done: Final event
        """
        try:
            assistant_response = ""

            # Define event emitter for status updates
            async def emit_status_event(event: dict):
                """Emit status event to frontend."""
                event_data = json.dumps(event)
                yield f"data: {event_data}\n\n"

            # Create generator for status events
            status_events = []
            async def status_emitter(event: dict):
                status_events.append(event)

            # Stream from n8n with status emitter
            async for chunk in streamer.stream_response(
                messages=current_messages,
                system_prompt=agent.system_prompt,
                config=agent.config,
                event_emitter=status_emitter,
            ):
                # Emit any pending status events
                for status_event in status_events:
                    event_data = json.dumps(status_event)
                    yield f"data: {event_data}\n\n"
                status_events.clear()
                assistant_response += chunk

                # Emit message chunk
                event_data = json.dumps({
                    "type": "message",
                    "data": {
                        "content": chunk
                    }
                })
                yield f"data: {event_data}\n\n"

            # Save assistant response to database using a new session
            from database import AsyncSessionLocal
            async with AsyncSessionLocal() as new_db:
                # Re-fetch chat in new session
                result = await new_db.execute(
                    select(Chat).where(Chat.id == UUID(chat_id_str))
                )
                db_chat = result.scalar_one()

                # Save assistant response
                assistant_message = {
                    "role": "assistant",
                    "content": assistant_response,
                    "timestamp": datetime.utcnow().isoformat()
                }

                updated_messages = db_chat.messages if db_chat.messages else []
                updated_messages.append(assistant_message)
                db_chat.messages = updated_messages

                await new_db.commit()

            logger.info(f"Assistant response saved to chat {chat_id_str}")

            # Emit any final status events
            for status_event in status_events:
                event_data = json.dumps(status_event)
                yield f"data: {event_data}\n\n"
            status_events.clear()

            # Send done event
            done_event = json.dumps({
                "type": "done",
                "data": {
                    "message": "Stream completed"
                }
            })
            yield f"data: {done_event}\n\n"

        except Exception as e:
            logger.error(f"Error streaming message: {e}")

            # Send error event
            error_event = json.dumps({
                "type": "error",
                "data": {
                    "message": str(e)
                }
            })
            yield f"data: {error_event}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        }
    )


# ============================================================================
# Legacy Compatibility Endpoints (for frontend)
# ============================================================================

@legacy_router.post(
    "/{agent_id}/message",
    summary="Send message (legacy endpoint)",
    description="Legacy endpoint for frontend compatibility. Finds or creates chat for user+agent, then sends message.",
)
async def send_message_legacy(
    agent_id: str,
    message: dict,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Send message using agent ID (legacy frontend compatibility).

    Flow:
    1. Verify agent exists and belongs to team
    2. Find existing chat for user + agent, or create new one
    3. Send message via streaming endpoint
    4. Return SSE stream

    Request body:
    {
        "message": "User message text"
    }
    """
    # Verify agent exists and belongs to team
    agent = await get_agent_by_id(agent_id, current_user.team_id, db)

    # Find existing chat for this user + agent
    result = await db.execute(
        select(Chat).where(
            and_(
                Chat.user_id == current_user.id,
                Chat.agent_id == agent.id,
                Chat.is_archived == False
            )
        ).order_by(desc(Chat.updated_at))
    )
    chat = result.scalar_one_or_none()

    # If no chat exists, create one
    if not chat:
        chat = Chat(
            team_id=current_user.team_id,
            user_id=current_user.id,
            agent_id=agent.id,
            title=f"Chat with {agent.name}",
            messages=[],
            chat_metadata={},
            is_archived=False,
        )
        db.add(chat)
        await db.commit()
        await db.refresh(chat)
        logger.info(f"Auto-created chat {chat.id} for user {current_user.id} with agent {agent.id}")

    # Prepare message request
    message_request = SendMessageRequest(content=message.get("message", ""))

    # Delegate to existing send_message endpoint
    return await send_message(
        chat_id=str(chat.id),
        message_data=message_request,
        current_user=current_user,
        db=db,
    )


@legacy_router.get(
    "/{agent_id}/history",
    summary="Get chat history (legacy endpoint)",
    description="Legacy endpoint for frontend compatibility. Returns chat history for user+agent.",
)
async def get_history_legacy(
    agent_id: str,
    limit: int = 50,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get chat history for user + agent (legacy frontend compatibility).

    Returns:
    {
        "messages": [
            {"role": "user", "content": "...", "timestamp": "..."},
            {"role": "assistant", "content": "...", "timestamp": "..."}
        ],
        "chat_id": "uuid"
    }
    """
    # Verify agent exists
    agent = await get_agent_by_id(agent_id, current_user.team_id, db)

    # Find chat for this user + agent
    result = await db.execute(
        select(Chat).where(
            and_(
                Chat.user_id == current_user.id,
                Chat.agent_id == agent.id,
                Chat.is_archived == False
            )
        ).order_by(desc(Chat.updated_at))
    )
    chat = result.scalar_one_or_none()

    if not chat:
        # No chat history yet
        return {
            "messages": [],
            "chat_id": None
        }

    # Return messages (limited)
    messages = chat.messages if chat.messages else []
    limited_messages = messages[-limit:] if len(messages) > limit else messages

    return {
        "messages": limited_messages,
        "chat_id": str(chat.id)
    }
