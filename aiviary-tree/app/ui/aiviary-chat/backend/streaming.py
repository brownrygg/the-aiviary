"""
AI Backend streaming helper class.

Supports multiple backend types:
1. n8n webhooks (original) - For workflow-based AI
2. OpenAI-compatible API (analytics-agent) - For direct LLM calls

Security:
- Bearer token authentication
- Async HTTP requests
- Error handling and logging
- Timeout protection
"""

import asyncio
import json
import logging
from typing import Callable, Awaitable, Optional, AsyncGenerator
from urllib.parse import urlparse
import aiohttp

logger = logging.getLogger(__name__)


class AIStreamer:
    """
    Helper class for streaming responses from AI backends.

    Supports:
    - n8n webhooks (concatenated JSON streaming)
    - OpenAI-compatible API (SSE streaming with delta format)

    Handles:
    - Async HTTP requests
    - Multiple streaming formats
    - Status updates via event emitter
    - Error handling and logging
    """

    # Backend types
    BACKEND_N8N = "n8n"
    BACKEND_OPENAI = "openai"

    def __init__(
        self,
        webhook_url: str,
        bearer_token: Optional[str] = None,
        timeout: int = 300,
        backend_type: Optional[str] = None,
    ):
        """
        Initialize AI streamer.

        Args:
            webhook_url: Backend URL (n8n webhook or OpenAI-compatible endpoint)
            bearer_token: Optional bearer token for authentication
            timeout: Request timeout in seconds (default 300)
            backend_type: Force backend type ("n8n" or "openai"). Auto-detected if None.
        """
        self.webhook_url = webhook_url
        self.bearer_token = bearer_token
        self.timeout = timeout

        # Auto-detect backend type from URL
        if backend_type:
            self.backend_type = backend_type
        else:
            self.backend_type = self._detect_backend_type(webhook_url)

        logger.info(f"AIStreamer initialized: {self.backend_type} backend at {webhook_url}")

    def _detect_backend_type(self, url: str) -> str:
        """
        Auto-detect backend type from URL patterns.

        OpenAI-compatible indicators:
        - Contains "/v1/chat/completions"
        - Contains "openai" in path
        - analytics-agent endpoint

        Otherwise defaults to n8n.
        """
        url_lower = url.lower()

        if "/v1/chat/completions" in url_lower:
            return self.BACKEND_OPENAI
        if "/v1/" in url_lower and "chat" in url_lower:
            return self.BACKEND_OPENAI
        if "analytics-agent" in url_lower:
            return self.BACKEND_OPENAI
        if "openai" in url_lower:
            return self.BACKEND_OPENAI

        # Default to n8n for webhook URLs
        return self.BACKEND_N8N

    async def emit_status(
        self,
        event_emitter: Optional[Callable[[dict], Awaitable[None]]],
        level: str,
        message: str,
        done: bool = False,
    ):
        """
        Emit status update via event emitter.

        Args:
            event_emitter: Callback function to emit events
            level: Status level (info, warning, error)
            message: Status message
            done: Whether this is the final status
        """
        if event_emitter:
            try:
                await event_emitter({
                    "type": "status",
                    "data": {
                        "description": message,
                        "level": level,
                        "done": done,
                    }
                })
            except Exception as e:
                logger.error(f"Error emitting status: {e}")

    def _build_openai_payload(
        self,
        messages: list[dict],
        system_prompt: Optional[str] = None,
        config: Optional[dict] = None,
    ) -> dict:
        """
        Build OpenAI-compatible request payload.

        Args:
            messages: Chat message history
            system_prompt: System prompt (prepended to messages)
            config: Additional configuration (model, temperature, etc.)

        Returns:
            OpenAI-compatible request payload
        """
        # Start with config or defaults
        payload = {
            "model": config.get("model", "aiviary-analytics-agent") if config else "aiviary-analytics-agent",
            "stream": True,
            "max_tokens": config.get("max_tokens", 4096) if config else 4096,
        }

        # Add optional parameters from config
        if config:
            if "temperature" in config:
                payload["temperature"] = config["temperature"]

        # Build messages array
        formatted_messages = []

        # Add system prompt if provided
        if system_prompt:
            formatted_messages.append({
                "role": "system",
                "content": system_prompt
            })

        # Add conversation messages
        for msg in messages:
            formatted_messages.append({
                "role": msg.get("role", "user"),
                "content": msg.get("content", "")
            })

        payload["messages"] = formatted_messages

        return payload

    def _build_n8n_payload(
        self,
        messages: list[dict],
        system_prompt: Optional[str] = None,
        config: Optional[dict] = None,
    ) -> dict:
        """
        Build n8n webhook request payload.

        Args:
            messages: Chat message history
            system_prompt: System prompt for the agent
            config: Additional configuration

        Returns:
            n8n webhook payload
        """
        payload = {
            "messages": messages,
        }

        if system_prompt:
            payload["system_prompt"] = system_prompt

        if config:
            payload["config"] = config

        return payload

    async def _stream_openai_response(
        self,
        session: aiohttp.ClientSession,
        payload: dict,
        headers: dict,
        event_emitter: Optional[Callable[[dict], Awaitable[None]]] = None,
    ) -> AsyncGenerator[str, None]:
        """
        Stream response from OpenAI-compatible endpoint.

        Handles SSE format:
        data: {"choices": [{"delta": {"content": "chunk"}}]}
        """
        await self.emit_status(
            event_emitter,
            "info",
            "Sending request to AI backend..."
        )

        async with session.post(
            self.webhook_url,
            json=payload,
            headers=headers,
        ) as response:

            if response.status != 200:
                error_text = await response.text()
                await self.emit_status(
                    event_emitter,
                    "error",
                    f"AI backend error: {response.status}",
                    done=True
                )
                raise Exception(f"AI backend returned {response.status}: {error_text}")

            await self.emit_status(
                event_emitter,
                "info",
                "Streaming response..."
            )

            # Handle SSE streaming
            async for line in response.content:
                line = line.decode("utf-8", errors="ignore").strip()

                if not line:
                    continue

                # SSE format: "data: {...}" or "data: [DONE]"
                if line.startswith("data: "):
                    data_str = line[6:]  # Remove "data: " prefix

                    if data_str == "[DONE]":
                        break

                    try:
                        data = json.loads(data_str)

                        # Extract content from OpenAI delta format
                        choices = data.get("choices", [])
                        if choices and isinstance(choices[0], dict):
                            delta = choices[0].get("delta", {})
                            content = delta.get("content", "")

                            if content:
                                yield content

                    except json.JSONDecodeError:
                        logger.warning(f"Failed to parse SSE data: {data_str[:100]}")
                        continue

            await self.emit_status(
                event_emitter,
                "info",
                "Stream completed",
                done=True
            )

    async def _stream_n8n_response(
        self,
        session: aiohttp.ClientSession,
        payload: dict,
        headers: dict,
        event_emitter: Optional[Callable[[dict], Awaitable[None]]] = None,
    ) -> AsyncGenerator[str, None]:
        """
        Stream response from n8n webhook.

        Handles concatenated JSON format:
        {"text": "chunk1"}{"text": "chunk2"}
        """
        await self.emit_status(
            event_emitter,
            "info",
            "Sending request to n8n webhook..."
        )

        async with session.post(
            self.webhook_url,
            json=payload,
            headers=headers,
        ) as response:

            if response.status != 200:
                error_text = await response.text()
                await self.emit_status(
                    event_emitter,
                    "error",
                    f"n8n webhook error: {response.status}",
                    done=True
                )
                raise Exception(f"n8n webhook returned {response.status}: {error_text}")

            # Check if response is streaming
            content_type = response.headers.get("Content-Type", "")

            is_streaming = (
                "text/event-stream" in content_type
                or "application/x-ndjson" in content_type
                or (
                    "application/json" in content_type
                    and response.headers.get("Transfer-Encoding") == "chunked"
                )
            )

            if is_streaming:
                # Handle n8n streaming (concatenated JSON objects)
                await self.emit_status(
                    event_emitter,
                    "info",
                    "Streaming response from n8n..."
                )

                buffer = ""
                async for chunk in response.content.iter_any():
                    if not chunk:
                        continue

                    text = chunk.decode("utf-8", errors="ignore")
                    buffer += text

                    # Process complete JSON objects using brace matching
                    while "{" in buffer and "}" in buffer:
                        start_idx = buffer.find("{")
                        if start_idx == -1:
                            break

                        # Find matching closing brace
                        brace_count = 0
                        end_idx = -1

                        for i in range(start_idx, len(buffer)):
                            if buffer[i] == "{":
                                brace_count += 1
                            elif buffer[i] == "}":
                                brace_count -= 1
                                if brace_count == 0:
                                    end_idx = i
                                    break

                        if end_idx == -1:
                            # Incomplete JSON, wait for more data
                            break

                        # Extract and process the JSON chunk
                        json_chunk = buffer[start_idx : end_idx + 1]
                        buffer = buffer[end_idx + 1 :]

                        try:
                            data = json.loads(json_chunk)

                            # Extract content from various field names
                            content = None
                            if isinstance(data, dict):
                                content = (
                                    data.get("text") or
                                    data.get("content") or
                                    data.get("output") or
                                    data.get("message") or
                                    data.get("delta") or
                                    data.get("data") or
                                    data.get("response") or
                                    data.get("result")
                                )

                                # Handle OpenAI-style streaming format
                                if not content and "choices" in data:
                                    choices = data.get("choices", [])
                                    if choices and isinstance(choices[0], dict):
                                        delta = choices[0].get("delta", {})
                                        content = delta.get("content", "")

                            if content:
                                # Normalize escaped newlines
                                content = str(content).replace("\\n", "\n")
                                yield content

                        except json.JSONDecodeError:
                            logger.warning(f"Failed to parse JSON chunk: {json_chunk[:100]}")
                            continue

                # Process any remaining content in buffer
                if buffer.strip():
                    try:
                        data = json.loads(buffer.strip())
                        content = (
                            data.get("text") or
                            data.get("content") or
                            data.get("output") or
                            data.get("message")
                        )
                        if content:
                            yield str(content).replace("\\n", "\n")
                    except json.JSONDecodeError:
                        # Use buffer as plain text
                        if buffer.strip():
                            yield buffer.strip()

                await self.emit_status(
                    event_emitter,
                    "info",
                    "Stream completed",
                    done=True
                )

            else:
                # Handle non-streaming response
                await self.emit_status(
                    event_emitter,
                    "info",
                    "Receiving response from n8n..."
                )

                response_text = await response.text()
                logger.info(f"Raw n8n response: {response_text[:500]}")

                try:
                    response_data = json.loads(response_text)
                except json.JSONDecodeError as e:
                    logger.error(f"Failed to parse n8n response as JSON: {e}")
                    yield response_text
                    return

                # Extract content from response
                content = None
                if isinstance(response_data, dict):
                    content = (
                        response_data.get("content") or
                        response_data.get("response") or
                        response_data.get("text") or
                        response_data.get("message")
                    )
                elif isinstance(response_data, str):
                    content = response_data

                if content:
                    yield content
                else:
                    logger.warning(f"Unknown response format: {response_data}")
                    yield json.dumps(response_data)

                await self.emit_status(
                    event_emitter,
                    "info",
                    "Response received",
                    done=True
                )

    async def stream_response(
        self,
        messages: list[dict],
        system_prompt: Optional[str] = None,
        config: Optional[dict] = None,
        event_emitter: Optional[Callable[[dict], Awaitable[None]]] = None,
    ) -> AsyncGenerator[str, None]:
        """
        Stream response from AI backend.

        Args:
            messages: Chat message history
            system_prompt: System prompt for the agent
            config: Additional configuration for the agent
            event_emitter: Optional callback for status updates

        Yields:
            Chunks of streamed response text

        Raises:
            Exception: If request fails or times out
        """
        # Build payload based on backend type
        if self.backend_type == self.BACKEND_OPENAI:
            payload = self._build_openai_payload(messages, system_prompt, config)
        else:
            payload = self._build_n8n_payload(messages, system_prompt, config)

        # Prepare headers
        headers = {
            "Content-Type": "application/json",
        }

        if self.bearer_token:
            headers["Authorization"] = f"Bearer {self.bearer_token}"

        try:
            timeout = aiohttp.ClientTimeout(total=self.timeout)

            async with aiohttp.ClientSession(timeout=timeout) as session:
                # Use appropriate streaming method
                if self.backend_type == self.BACKEND_OPENAI:
                    async for chunk in self._stream_openai_response(
                        session, payload, headers, event_emitter
                    ):
                        yield chunk
                else:
                    async for chunk in self._stream_n8n_response(
                        session, payload, headers, event_emitter
                    ):
                        yield chunk

        except asyncio.TimeoutError:
            await self.emit_status(
                event_emitter,
                "error",
                "Request timed out",
                done=True
            )
            raise Exception(f"AI backend request timed out after {self.timeout}s")

        except Exception as e:
            logger.error(f"Error streaming from AI backend: {e}")
            await self.emit_status(
                event_emitter,
                "error",
                f"Error: {str(e)}",
                done=True
            )
            raise

    async def get_response(
        self,
        messages: list[dict],
        system_prompt: Optional[str] = None,
        config: Optional[dict] = None,
        event_emitter: Optional[Callable[[dict], Awaitable[None]]] = None,
    ) -> str:
        """
        Get complete response from AI backend (non-streaming).

        Args:
            messages: Chat message history
            system_prompt: System prompt for the agent
            config: Additional configuration for the agent
            event_emitter: Optional callback for status updates

        Returns:
            Complete response text

        Raises:
            Exception: If request fails or times out
        """
        response_text = ""

        async for chunk in self.stream_response(
            messages=messages,
            system_prompt=system_prompt,
            config=config,
            event_emitter=event_emitter,
        ):
            response_text += chunk

        return response_text


# Backwards compatibility alias
N8nStreamer = AIStreamer
