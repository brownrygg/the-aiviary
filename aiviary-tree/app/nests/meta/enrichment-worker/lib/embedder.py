import os
import requests
from typing import List, Dict, Any
import magic  # For python-magic

import vertexai
from vertexai.vision_models import Image, MultiModalEmbeddingModel

# ============================================================================
# CONFIGURATION
# ============================================================================

# Initialize Vertex AI (reads GOOGLE_APPLICATION_CREDENTIALS automatically)
vertexai.init(
    project=os.getenv("GOOGLE_CLOUD_PROJECT"),
    location=os.getenv("VERTEX_AI_LOCATION", "us-central1")
)

# Load the multimodal embedding model (1408 dimensions)
embedding_model = MultiModalEmbeddingModel.from_pretrained("multimodalembedding@001")

MAX_DOWNLOAD_SIZE_MB = 10
MAX_TEXT_BYTES = 1024  # Max BYTES for contextual text (Vertex AI limit - NOT characters!)

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def truncate_to_bytes(text: str, max_bytes: int = MAX_TEXT_BYTES) -> str:
    """
    Truncate text to max_bytes when encoded as UTF-8.

    CRITICAL: Vertex AI has a 1024 BYTE limit, not character limit.
    Emoji and special characters can be 2-4 bytes each in UTF-8.
    """
    if not text:
        return ''

    encoded = text.encode('utf-8')
    if len(encoded) <= max_bytes:
        return text

    # Truncate bytes and decode, handling potential cut multi-byte characters
    truncated = encoded[:max_bytes]
    # Decode with 'ignore' to skip incomplete multi-byte sequences at the end
    return truncated.decode('utf-8', errors='ignore')

def download_media(url: str) -> Dict[str, Any]:
    """Downloads a media file (image/video thumbnail) from a URL."""
    try:
        response = requests.get(url, stream=True, timeout=15)
        response.raise_for_status()  # Raise an exception for HTTP errors

        # Check content length before downloading everything
        content_length = int(response.headers.get('content-length', 0))
        if content_length > MAX_DOWNLOAD_SIZE_MB * 1024 * 1024:
            raise Exception(f"Media file too large: {content_length / (1024*1024):.2f} MB")

        buffer = b''
        for chunk in response.iter_content(chunk_size=8192):
            buffer += chunk
            if len(buffer) > MAX_DOWNLOAD_SIZE_MB * 1024 * 1024:
                raise Exception(f"Downloaded media exceeded {MAX_DOWNLOAD_SIZE_MB} MB")

        mime_type = magic.Magic(mime=True).from_buffer(buffer)

        if not (mime_type.startswith('image/') or mime_type.startswith('video/')):
            raise Exception(f"Unsupported MIME type: {mime_type}")

        return {"buffer": buffer, "mime_type": mime_type}
    except Exception as e:
        print(f"[Embedder] Media download failed for URL {url}: {e}")
        raise Exception(f"Failed to download or validate media: {e}")

# ============================================================================
# CORE MULTIMODAL EMBEDDING LOGIC
# ============================================================================

def generate_multimodal_embedding(text: str, media_url: str, media_type: str = 'IMAGE') -> List[float]:
    """
    Generates a multimodal embedding using Vertex AI.

    Args:
        text: Caption or contextual text (optional)
        media_url: URL to image or video thumbnail
        media_type: 'IMAGE' or 'VIDEO' (for Phase 3+)

    Returns:
        List of 1408 floats representing the embedding vector

    Raises:
        Exception: If embedding generation fails
    """
    if not text and not media_url:
        raise Exception('Either text or a media URL must be provided to generate an embedding.')

    # 1. Download and prepare the media
    media_data = download_media(media_url)

    # 2. Truncate text to ensure it's under 1024 BYTES (not characters!)
    truncated_text = truncate_to_bytes(text)
    original_bytes = len(text.encode('utf-8')) if text else 0
    truncated_bytes = len(truncated_text.encode('utf-8'))

    if original_bytes > MAX_TEXT_BYTES:
        print(f"[Embedder] Caption truncated: {original_bytes} bytes → {truncated_bytes} bytes ({len(text)} chars → {len(truncated_text)} chars)")

    # 3. Generate multimodal embedding using Vertex AI
    try:
        # Create Image object from raw bytes
        image = Image(image_bytes=media_data['buffer'])

        # Generate embedding with image + contextual text
        # dimension=1408 is the fixed size for multimodalembedding@001
        embeddings = embedding_model.get_embeddings(
            image=image,
            contextual_text=truncated_text if truncated_text else None,
            dimension=1408
        )

        # Extract the embedding vector from the response
        # The response object has image_embedding (singular), not image_embeddings (plural)
        embedding_vector = embeddings.image_embedding

        # Validate dimension
        if not embedding_vector or len(embedding_vector) != 1408:
            raise Exception(f'Invalid embedding received: expected 1408 dimensions, got {len(embedding_vector)}')

        return embedding_vector

    except Exception as e:
        print(f"[Embedder] Vertex AI embedding API error: {e}")
        if "400" in str(e):
            raise Exception('The media format may be unsupported by the embedding model.')
        raise Exception(f"Failed to generate multimodal embedding: {e}")

def generate_text_embedding(text: str) -> List[float]:
    """
    Generates a text-only embedding for a user query (1408 dimensions, compatible with multimodal).

    This is used by the analytics agent to generate query embeddings that can be compared
    with multimodal embeddings using cosine similarity.

    Args:
        text: Query text

    Returns:
        List of 1408 floats representing the embedding vector
    """
    if not text:
        raise Exception('Text must be provided to generate an embedding.')

    try:
        # Truncate text to ensure it's under 1024 BYTES (not characters!)
        truncated_text = truncate_to_bytes(text)

        # Use multimodal model with text-only input to get 1408-dimension embedding
        # This ensures compatibility with image+text embeddings
        embeddings = embedding_model.get_embeddings(
            contextual_text=truncated_text,
            dimension=1408
        )

        # Extract text embedding
        embedding_vector = embeddings.text_embedding

        # Validate dimension
        if not embedding_vector or len(embedding_vector) != 1408:
            raise Exception(f'Invalid text embedding received: expected 1408 dimensions, got {len(embedding_vector)}')

        return embedding_vector

    except Exception as e:
        print(f"[Embedder] Vertex AI text embedding API error: {e}")
        raise Exception(f"Failed to generate text embedding: {e}")
