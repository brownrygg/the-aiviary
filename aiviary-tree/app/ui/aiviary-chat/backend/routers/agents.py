from __future__ import annotations

"""
Agent management router - CRUD operations for AI agents.

Endpoints:
- GET /api/agents - List all agents (filtered by user's team)
- POST /api/agents - Create new agent (admin only)
- GET /api/agents/{id} - Get agent details
- PUT /api/agents/{id} - Update agent (admin only)
- DELETE /api/agents/{id} - Delete agent (admin only)
- POST /api/agents/{id}/avatar - Upload avatar (admin only)

Security:
- All endpoints require authentication
- Agents are filtered by team_id
- Only admins can create/update/delete agents
- Avatar upload validates image format and size
"""

import base64
import logging
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import and_

from auth import get_current_active_user
from database import get_db
from models import User, Agent
from schemas import AgentCreate, AgentUpdate, AgentResponse, MessageResponse, ErrorResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agents", tags=["agents"])


# ============================================================================
# Helper Functions
# ============================================================================

async def verify_admin(current_user: User) -> None:
    """
    Verify user has admin role.

    Args:
        current_user: Current authenticated user

    Raises:
        HTTPException: 403 if user is not admin
    """
    if current_user.role != "admin":
        logger.warning(f"Non-admin user attempted admin action: {current_user.id}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required"
        )


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
                Agent.team_id == team_id
            )
        )
    )
    agent = result.scalar_one_or_none()

    if not agent:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Agent not found"
        )

    return agent


def validate_avatar_base64(avatar: str) -> bool:
    """
    Validate base64 avatar data URI.

    Args:
        avatar: Base64 data URI string

    Returns:
        True if valid, False otherwise
    """
    if not avatar:
        return True

    # Check if it's a data URI
    if not avatar.startswith("data:image/"):
        return False

    # Check format: data:image/<type>;base64,<data>
    try:
        header, data = avatar.split(",", 1)
        if ";base64" not in header:
            return False

        # Validate base64
        base64.b64decode(data)
        return True
    except Exception:
        return False


# ============================================================================
# Agent Endpoints
# ============================================================================

@router.get(
    "",
    response_model=List[AgentResponse],
    summary="List all agents",
    description="Get all agents for the current user's team. Only returns active agents by default.",
)
async def list_agents(
    include_inactive: bool = False,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> List[Agent]:
    """
    List all agents for user's team.

    Security:
    - Filtered by team_id
    - Only shows active agents by default
    """
    query = select(Agent).where(Agent.team_id == current_user.team_id)

    if not include_inactive:
        query = query.where(Agent.is_active == True)

    query = query.order_by(Agent.name)

    result = await db.execute(query)
    agents = result.scalars().all()

    logger.info(f"User {current_user.id} listed {len(agents)} agents")

    return agents


@router.post(
    "",
    response_model=AgentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create new agent",
    description="Create a new AI agent. Requires admin privileges.",
)
async def create_agent(
    agent_data: AgentCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> Agent:
    """
    Create new agent.

    Security:
    - Admin only
    - Validates webhook URL uniqueness
    - Validates avatar format
    """
    # Verify admin
    await verify_admin(current_user)

    # Validate avatar if provided
    if agent_data.avatar and not validate_avatar_base64(agent_data.avatar):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid avatar format. Must be base64 data URI."
        )

    # Check if webhook URL already exists
    result = await db.execute(
        select(Agent).where(Agent.webhook_url == agent_data.webhook_url)
    )
    existing_agent = result.scalar_one_or_none()

    if existing_agent:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Webhook URL already in use"
        )

    # Create agent
    new_agent = Agent(
        team_id=current_user.team_id,
        created_by=current_user.id,
        name=agent_data.name,
        description=agent_data.description,
        webhook_url=agent_data.webhook_url,
        webhook_token=agent_data.webhook_token,
        system_prompt=agent_data.system_prompt,
        avatar=agent_data.avatar,
        config=agent_data.config or {},
        is_active=True,
    )

    db.add(new_agent)
    await db.commit()
    await db.refresh(new_agent)

    logger.info(f"Admin {current_user.id} created agent {new_agent.id}")

    return new_agent


@router.get(
    "/{agent_id}",
    response_model=AgentResponse,
    summary="Get agent details",
    description="Get details of a specific agent.",
)
async def get_agent(
    agent_id: str,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> Agent:
    """
    Get agent by ID.

    Security:
    - Verifies agent belongs to user's team
    """
    agent = await get_agent_by_id(agent_id, current_user.team_id, db)

    logger.info(f"User {current_user.id} retrieved agent {agent.id}")

    return agent


@router.put(
    "/{agent_id}",
    response_model=AgentResponse,
    summary="Update agent",
    description="Update an existing agent. Requires admin privileges.",
)
async def update_agent(
    agent_id: str,
    agent_data: AgentUpdate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> Agent:
    """
    Update agent.

    Security:
    - Admin only
    - Verifies agent belongs to user's team
    - Validates webhook URL uniqueness if changed
    - Validates avatar format if changed
    """
    # Verify admin
    await verify_admin(current_user)

    # Get existing agent
    agent = await get_agent_by_id(agent_id, current_user.team_id, db)

    # Validate avatar if provided
    if agent_data.avatar and not validate_avatar_base64(agent_data.avatar):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid avatar format. Must be base64 data URI."
        )

    # Check webhook URL uniqueness if changed
    if agent_data.webhook_url and agent_data.webhook_url != agent.webhook_url:
        result = await db.execute(
            select(Agent).where(Agent.webhook_url == agent_data.webhook_url)
        )
        existing_agent = result.scalar_one_or_none()

        if existing_agent:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Webhook URL already in use"
            )

    # Update fields
    update_data = agent_data.model_dump(exclude_unset=True)

    for field, value in update_data.items():
        setattr(agent, field, value)

    await db.commit()
    await db.refresh(agent)

    logger.info(f"Admin {current_user.id} updated agent {agent.id}")

    return agent


@router.delete(
    "/{agent_id}",
    response_model=MessageResponse,
    summary="Delete agent",
    description="Delete an agent. Requires admin privileges.",
)
async def delete_agent(
    agent_id: str,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """
    Delete agent.

    Security:
    - Admin only
    - Verifies agent belongs to user's team
    - Cascades to delete associated chats
    """
    # Verify admin
    await verify_admin(current_user)

    # Get existing agent
    agent = await get_agent_by_id(agent_id, current_user.team_id, db)

    # Delete agent (cascades to chats)
    await db.delete(agent)
    await db.commit()

    logger.info(f"Admin {current_user.id} deleted agent {agent.id}")

    return MessageResponse(message="Agent deleted successfully")


@router.post(
    "/{agent_id}/avatar",
    response_model=AgentResponse,
    summary="Upload agent avatar",
    description="Upload avatar image for an agent. Requires admin privileges.",
)
async def upload_avatar(
    agent_id: str,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> Agent:
    """
    Upload agent avatar.

    Security:
    - Admin only
    - Validates image format (PNG, JPG, JPEG, GIF, WebP)
    - Validates file size (max 2MB)
    - Converts to base64 data URI
    """
    # Verify admin
    await verify_admin(current_user)

    # Get existing agent
    agent = await get_agent_by_id(agent_id, current_user.team_id, db)

    # Validate file type
    allowed_types = ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"]
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file type. Allowed: {', '.join(allowed_types)}"
        )

    # Read file
    file_content = await file.read()

    # Validate file size (max 2MB)
    max_size = 2 * 1024 * 1024  # 2MB
    if len(file_content) > max_size:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File too large. Maximum size is 2MB."
        )

    # Convert to base64 data URI
    base64_data = base64.b64encode(file_content).decode("utf-8")
    data_uri = f"data:{file.content_type};base64,{base64_data}"

    # Update agent avatar
    agent.avatar = data_uri
    await db.commit()
    await db.refresh(agent)

    logger.info(f"Admin {current_user.id} uploaded avatar for agent {agent.id}")

    return agent
