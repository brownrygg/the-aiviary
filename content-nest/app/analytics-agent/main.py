import os
import time
import traceback
import json
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Optional

from agent import AnalyticsAgent, AgentConfig, Database

# ============================================================================
# DATA MODELS
# ============================================================================

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    model: str
    messages: List[ChatMessage]
    stream: Optional[bool] = False
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None

# ============================================================================
# FASTAPI APPLICATION SETUP
# ============================================================================

# Load configuration and initialize the agent and database
# This happens once on startup
agent_config = AgentConfig()
database = Database()
agent = AnalyticsAgent(config=agent_config, db=database)

app = FastAPI(
    title="Aiviary Analytics Agent",
    description="A self-contained, pre-configured AI agent for social media analytics.",
    version="1.0.0"
)

# ============================================================================
# API ENDPOINTS
# ============================================================================

@app.get("/v1/models")
async def list_models():
    """
    OpenWebUI calls this endpoint to see what models are available.
    We'll return our single, virtual model.
    """
    return {
        "object": "list",
        "data": [
            {
                "id": agent.config.model_name,
                "object": "model",
                "created": 1677610600,
                "owned_by": "Aiviary"
            }
        ]
    }

@app.post("/v1/chat/completions")
async def chat_completions(request: ChatRequest):
    """
    This is the main endpoint that OpenWebUI will call.
    It mimics the OpenAI Chat Completions API.
    """
    try:
        # Convert Pydantic models to simple dicts for the agent
        messages_dict = [msg.dict() for msg in request.messages]

        # Call the agent's chat method
        anthropic_response = await agent.chat(messages_dict)

        # Extract the final text content from the response
        final_content = ""
        if anthropic_response.content:
            # Iterate through content blocks to find text
            for block in anthropic_response.content:
                if block.type == 'text':
                    final_content += block.text

        print(f"[OpenAI Endpoint] Final content length: {len(final_content)}")
        if len(final_content) == 0:
            print(f"[OpenAI Endpoint] WARNING: Empty final_content! Response has {len(anthropic_response.content)} blocks")
            for i, block in enumerate(anthropic_response.content):
                print(f"[OpenAI Endpoint] Block {i}: type={block.type}")

        # Map Anthropic's stop_reason to OpenAI's finish_reason
        finish_reason_map = {
            "end_turn": "stop",
            "max_tokens": "length",
            "stop_sequence": "stop",
            "tool_use": "tool_calls"
        }
        finish_reason = finish_reason_map.get(anthropic_response.stop_reason, "stop")

        # Handle streaming vs non-streaming response
        if request.stream:
            print("[OpenAI Endpoint] Streaming mode enabled")

            async def generate_stream():
                """Generate SSE-formatted streaming response"""
                chunk_id = f"chatcmpl-{anthropic_response.id}"
                created = int(time.time())

                # Stream the content in chunks (simulate streaming by chunking the text)
                chunk_size = 50  # Characters per chunk
                for i in range(0, len(final_content), chunk_size):
                    chunk_text = final_content[i:i + chunk_size]

                    chunk_data = {
                        "id": chunk_id,
                        "object": "chat.completion.chunk",
                        "created": created,
                        "model": anthropic_response.model,
                        "choices": [
                            {
                                "index": 0,
                                "delta": {
                                    "content": chunk_text
                                },
                                "finish_reason": None
                            }
                        ]
                    }
                    yield f"data: {json.dumps(chunk_data)}\n\n"

                # Send final chunk with finish_reason
                final_chunk = {
                    "id": chunk_id,
                    "object": "chat.completion.chunk",
                    "created": created,
                    "model": anthropic_response.model,
                    "choices": [
                        {
                            "index": 0,
                            "delta": {},
                            "finish_reason": finish_reason
                        }
                    ]
                }
                yield f"data: {json.dumps(final_chunk)}\n\n"
                yield "data: [DONE]\n\n"

            return StreamingResponse(generate_stream(), media_type="text/event-stream")

        else:
            # Non-streaming response
            print("[OpenAI Endpoint] Non-streaming mode")
            response_data = {
                "id": anthropic_response.id,
                "object": "chat.completion",
                "created": int(time.time()),
                "model": anthropic_response.model,
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": final_content,
                        },
                        "finish_reason": finish_reason,
                    }
                ],
                "usage": {
                    "prompt_tokens": anthropic_response.usage.input_tokens,
                    "completion_tokens": anthropic_response.usage.output_tokens,
                    "total_tokens": anthropic_response.usage.input_tokens + anthropic_response.usage.output_tokens,
                },
            }
            return JSONResponse(content=response_data)

    except Exception as e:
        # Log the full error with stack trace for debugging
        print(f"Error in chat_completions: {str(e)}")
        print(traceback.format_exc())

        # Return a more detailed error in development
        error_detail = {
            "error": {
                "message": str(e),
                "type": type(e).__name__,
                "code": "internal_error"
            }
        }

        raise HTTPException(status_code=500, detail=error_detail)

# ============================================================================
# HEALTH CHECK
# ============================================================================

@app.get("/health")
async def health_check():
    return {"status": "ok"}
