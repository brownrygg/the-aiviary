"""
Pydantic models for request validation and response serialization.

Security considerations:
- Passwords are never returned in responses
- Email validation prevents injection attacks
- Type hints ensure data integrity
- Separate models for requests and responses prevent data leakage
"""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr, Field, validator


# ============================================================================
# Request Models (Input Validation)
# ============================================================================

class UserRegister(BaseModel):
    """
    Registration request model.

    Security validations:
    - Email format validation via EmailStr
    - Password minimum length requirement
    - Name length limits to prevent buffer overflow attacks
    - Team ID required for multi-tenant isolation
    """
    email: EmailStr = Field(..., description="User email address")
    password: str = Field(..., min_length=8, max_length=100, description="Password (8-100 characters)")
    full_name: Optional[str] = Field(None, max_length=255, description="User's full name")
    team_id: str = Field(..., description="Team UUID")

    @validator('password')
    def validate_password_strength(cls, v):
        """
        Enforce password complexity requirements.

        Requirements:
        - At least 8 characters
        - At least one uppercase letter
        - At least one lowercase letter
        - At least one number
        """
        if len(v) < 8:
            raise ValueError('Password must be at least 8 characters long')

        if not any(char.isupper() for char in v):
            raise ValueError('Password must contain at least one uppercase letter')

        if not any(char.islower() for char in v):
            raise ValueError('Password must contain at least one lowercase letter')

        if not any(char.isdigit() for char in v):
            raise ValueError('Password must contain at least one number')

        return v

    @validator('email')
    def normalize_email(cls, v):
        """Normalize email to lowercase for consistent storage."""
        return v.lower().strip() if v else v

    class Config:
        json_schema_extra = {
            "example": {
                "email": "user@example.com",
                "password": "SecurePass123",
                "full_name": "John Doe",
                "team_id": "550e8400-e29b-41d4-a716-446655440001"
            }
        }


class UserLogin(BaseModel):
    """
    Login request model.

    Security note:
    - Does not indicate whether email exists (prevents account enumeration)
    - Simple validation to prevent basic injection attempts
    """
    email: EmailStr = Field(..., description="User email address")
    password: str = Field(..., min_length=1, max_length=100, description="User password")

    @validator('email')
    def normalize_email(cls, v):
        """Normalize email to lowercase for consistent lookup."""
        return v.lower().strip() if v else v

    class Config:
        json_schema_extra = {
            "example": {
                "email": "user@example.com",
                "password": "SecurePass123"
            }
        }


class UserUpdate(BaseModel):
    """
    User update request model.

    Security:
    - Password updates require current password verification (not shown here)
    - Fields are optional to support partial updates
    """
    full_name: Optional[str] = Field(None, max_length=255)
    email: Optional[EmailStr] = None

    @validator('email')
    def normalize_email(cls, v):
        """Normalize email to lowercase."""
        return v.lower().strip() if v else v

    class Config:
        json_schema_extra = {
            "example": {
                "full_name": "Jane Doe",
                "email": "newemail@example.com"
            }
        }


class PasswordChange(BaseModel):
    """
    Password change request model.

    Security:
    - Requires current password to prevent unauthorized changes
    - New password must meet complexity requirements
    """
    current_password: str = Field(..., min_length=1, max_length=100)
    new_password: str = Field(..., min_length=8, max_length=100)

    @validator('new_password')
    def validate_password_strength(cls, v):
        """Enforce password complexity requirements."""
        if len(v) < 8:
            raise ValueError('Password must be at least 8 characters long')

        if not any(char.isupper() for char in v):
            raise ValueError('Password must contain at least one uppercase letter')

        if not any(char.islower() for char in v):
            raise ValueError('Password must contain at least one lowercase letter')

        if not any(char.isdigit() for char in v):
            raise ValueError('Password must contain at least one number')

        return v


# ============================================================================
# Response Models (Output Serialization)
# ============================================================================

class UserResponse(BaseModel):
    """
    User response model.

    Security:
    - NEVER includes password_hash or any password data
    - Only exposes safe, non-sensitive user information
    - Used for all user-related API responses
    """
    id: str
    team_id: str
    email: str
    full_name: Optional[str]
    role: str
    avatar: Optional[str]
    preferences: dict
    is_active: bool
    last_login_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True  # Enables SQLAlchemy model compatibility
        json_schema_extra = {
            "example": {
                "id": "550e8400-e29b-41d4-a716-446655440000",
                "team_id": "550e8400-e29b-41d4-a716-446655440001",
                "email": "user@example.com",
                "full_name": "John Doe",
                "role": "user",
                "avatar": None,
                "preferences": {},
                "is_active": True,
                "last_login_at": "2025-01-15T10:30:00",
                "created_at": "2025-01-01T00:00:00"
            }
        }


class TokenResponse(BaseModel):
    """
    Token response model.

    Security note:
    - In production, tokens are sent via httpOnly cookies, not response body
    - This model is kept for flexibility and non-browser clients
    - access_token should NEVER be logged
    """
    access_token: str
    token_type: str = "bearer"

    class Config:
        json_schema_extra = {
            "example": {
                "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                "token_type": "bearer"
            }
        }


class MessageResponse(BaseModel):
    """Generic message response for operations like logout."""
    message: str

    class Config:
        json_schema_extra = {
            "example": {
                "message": "Successfully logged out"
            }
        }


class ErrorResponse(BaseModel):
    """
    Standardized error response.

    Security:
    - Detail messages should be generic to prevent information leakage
    - Never expose stack traces or internal errors to clients
    """
    detail: str

    class Config:
        json_schema_extra = {
            "example": {
                "detail": "Invalid credentials"
            }
        }


# ============================================================================
# Agent Models
# ============================================================================

class AgentCreate(BaseModel):
    """Agent creation request model."""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=1000)
    webhook_url: str = Field(..., min_length=1)
    webhook_token: Optional[str] = None
    system_prompt: Optional[str] = None
    avatar: Optional[str] = None
    config: dict = Field(default_factory=dict)

    class Config:
        json_schema_extra = {
            "example": {
                "name": "Support Bot",
                "description": "Customer support assistant",
                "webhook_url": "https://n8n.example.com/webhook/support-bot",
                "webhook_token": "secret_token_123",
                "system_prompt": "You are a helpful customer support assistant.",
                "config": {"model": "gpt-4", "temperature": 0.7}
            }
        }


class AgentUpdate(BaseModel):
    """Agent update request model."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=1000)
    webhook_url: Optional[str] = None
    webhook_token: Optional[str] = None
    system_prompt: Optional[str] = None
    avatar: Optional[str] = None
    config: Optional[dict] = None
    is_active: Optional[bool] = None

    class Config:
        json_schema_extra = {
            "example": {
                "name": "Support Bot Updated",
                "description": "Updated customer support assistant"
            }
        }


class AgentResponse(BaseModel):
    """Agent response model."""
    id: str
    team_id: str
    created_by: str
    name: str
    description: Optional[str]
    webhook_url: str
    webhook_token: Optional[str]
    system_prompt: Optional[str]
    avatar: Optional[str]
    config: dict
    is_active: bool
    created_at: datetime
    updated_at: datetime

    @validator('id', 'team_id', 'created_by', pre=True)
    def convert_uuid_to_str(cls, v):
        """Convert UUID objects to strings."""
        if v is not None and hasattr(v, '__str__'):
            return str(v)
        return v

    class Config:
        from_attributes = True
        json_schema_extra = {
            "example": {
                "id": "550e8400-e29b-41d4-a716-446655440002",
                "team_id": "550e8400-e29b-41d4-a716-446655440001",
                "created_by": "550e8400-e29b-41d4-a716-446655440000",
                "name": "Support Bot",
                "description": "Customer support assistant",
                "webhook_url": "https://n8n.example.com/webhook/support-bot",
                "webhook_token": "secret_token_123",
                "system_prompt": "You are a helpful customer support assistant.",
                "avatar": None,
                "config": {"model": "gpt-4", "temperature": 0.7},
                "is_active": True,
                "created_at": "2025-01-01T00:00:00",
                "updated_at": "2025-01-01T00:00:00"
            }
        }


# ============================================================================
# Chat and Message Models
# ============================================================================

class MessageContent(BaseModel):
    """Single message in a chat."""
    role: str = Field(..., pattern="^(user|assistant|system)$")
    content: str
    timestamp: datetime

    class Config:
        json_schema_extra = {
            "example": {
                "role": "user",
                "content": "Hello, I need help",
                "timestamp": "2025-01-01T10:00:00"
            }
        }


class ChatCreate(BaseModel):
    """Chat creation request model."""
    agent_id: str = Field(..., description="UUID of the agent to chat with")
    title: Optional[str] = Field(None, max_length=255)
    chat_metadata: dict = Field(default_factory=dict)

    class Config:
        json_schema_extra = {
            "example": {
                "agent_id": "550e8400-e29b-41d4-a716-446655440002",
                "title": "Support Request",
                "chat_metadata": {"tags": ["support"]}
            }
        }


class ChatUpdate(BaseModel):
    """Chat update request model."""
    title: Optional[str] = Field(None, max_length=255)
    chat_metadata: Optional[dict] = None
    is_archived: Optional[bool] = None

    class Config:
        json_schema_extra = {
            "example": {
                "title": "Updated Support Request",
                "is_archived": False
            }
        }


class ChatResponse(BaseModel):
    """Chat response model."""
    id: str
    team_id: str
    user_id: str
    agent_id: str
    title: Optional[str]
    messages: list
    chat_metadata: dict
    is_archived: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
        json_schema_extra = {
            "example": {
                "id": "550e8400-e29b-41d4-a716-446655440003",
                "team_id": "550e8400-e29b-41d4-a716-446655440001",
                "user_id": "550e8400-e29b-41d4-a716-446655440000",
                "agent_id": "550e8400-e29b-41d4-a716-446655440002",
                "title": "Support Request",
                "messages": [
                    {
                        "role": "user",
                        "content": "Hello",
                        "timestamp": "2025-01-01T10:00:00"
                    }
                ],
                "chat_metadata": {"tags": ["support"]},
                "is_archived": False,
                "created_at": "2025-01-01T00:00:00",
                "updated_at": "2025-01-01T00:00:00"
            }
        }


class SendMessageRequest(BaseModel):
    """Request to send a message to a chat."""
    content: str = Field(..., min_length=1, max_length=10000)

    class Config:
        json_schema_extra = {
            "example": {
                "content": "Hello, I need help with my account"
            }
        }
