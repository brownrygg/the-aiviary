import os
import asyncio
import time
import json
import logging
from typing import Dict, Any, List, Optional

import psycopg2
from psycopg2 import pool
from pgvector.psycopg2 import register_vector

from lib.embedder import generate_multimodal_embedding
from lib.audio_extractor import process_video_for_transcription, split_audio_into_chunks, cleanup_temp_files, NoAudioTrackError
from lib.transcriber import transcribe_audio, transcribe_long_audio

# ============================================================================
# CONFIGURATION & LOGGER
# ============================================================================

# Set up logging
logging.basicConfig(
    level=os.getenv('LOG_LEVEL', 'INFO').upper(),
    format='[%(asctime)s] [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# Worker Configuration
POLL_INTERVAL_MS = int(os.getenv('POLL_INTERVAL_MS', 30000))
MAX_RETRY_ATTEMPTS = int(os.getenv('MAX_RETRY_ATTEMPTS', 3))
RETRY_BACKOFF_MINUTES = json.loads(os.getenv('RETRY_BACKOFF_MINUTES', '[5, 10, 20]'))

CLIENT_ID = os.getenv("CLIENT_ID", "client") # Default client ID

# ============================================================================
# DATABASE CONNECTION
# ============================================================================

try:
    DB_POOL = pool.SimpleConnectionPool(
        minconn=1,
        maxconn=5,
        host=os.getenv("POSTGRES_HOST", "postgres"),
        port=os.getenv("POSTGRES_PORT", "5432"),
        dbname=os.getenv("POSTGRES_DB", "analytics"),
        user=os.getenv("POSTGRES_USER"),
        password=os.getenv("POSTGRES_PASSWORD")
    )
    # Register pgvector type with psycopg2 (must be done with an active connection)
    conn = DB_POOL.getconn()
    register_vector(conn)
    DB_POOL.putconn(conn)
    logger.info("PostgreSQL connection pool initialized.")
except Exception as e:
    logger.critical(f"Failed to initialize PostgreSQL pool: {e}")
    exit(1)

async def get_db_conn():
    return DB_POOL.getconn()

def put_db_conn(conn):
    DB_POOL.putconn(conn)

# ============================================================================
# JOB PROCESSING LOGIC
# ============================================================================

async def get_next_job() -> Optional[Dict[str, Any]]:
    conn = await get_db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE enrichment_jobs
                SET status = 'processing', started_at = NOW(), updated_at = NOW()
                WHERE id = (
                    SELECT id
                    FROM enrichment_jobs
                    WHERE status = 'pending' AND attempts < %s
                    ORDER BY created_at ASC
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                )
                RETURNING id, client_id, content_id, content_type, attempts
                """,
                (MAX_RETRY_ATTEMPTS,)
            )
            job = cur.fetchone()
            conn.commit()
            if job:
                return {
                    "id": job[0],
                    "client_id": job[1],
                    "content_id": job[2],
                    "content_type": job[3],
                    "attempts": job[4]
                }
            return None
    except Exception as e:
        conn.rollback()
        logger.error(f"Error getting next job: {e}")
        raise
    finally:
        put_db_conn(conn)

async def fetch_content(content_type: str, content_id: str, client_id: str) -> Dict[str, Any]:
    conn = await get_db_conn()
    try:
        with conn.cursor() as cur:
            if content_type == 'instagram_posts':
                cur.execute(
                    "SELECT id, caption, media_type, media_url, thumbnail_url FROM instagram_posts WHERE id = %s AND client_id = %s",
                    (content_id, client_id)
                )
            else:
                raise Exception(f"Unsupported content type for multimodal embedding: {content_type}")
            
            content = cur.fetchone()
            if not content:
                raise Exception(f"Content not found: {content_type}/{content_id}")
            
            return {"id": content[0], "caption": content[1], "media_type": content[2], "media_url": content[3], "thumbnail_url": content[4]}
    except Exception as e:
        logger.error(f"Error fetching content {content_type}/{content_id}: {e}")
        raise
    finally:
        put_db_conn(conn)

async def get_primary_media_url(post: Dict[str, Any], client_id: str) -> Optional[str]:
    conn = await get_db_conn()
    try:
        with conn.cursor() as cur:
            if post['media_type'] == 'IMAGE':
                return post['media_url']
            elif post['media_type'] == 'VIDEO':
                return post['thumbnail_url']
            elif post['media_type'] == 'CAROUSEL_ALBUM':
                cur.execute(
                    "SELECT media_url, thumbnail_url, media_type FROM instagram_post_children WHERE post_id = %s AND client_id = %s ORDER BY id LIMIT 1",
                    (post['id'], client_id)
                )
                child = cur.fetchone()
                if child:
                    return child[2] == 'VIDEO' and child[1] or child[0] # thumbnail_url for video, media_url for image
            return None
    except Exception as e:
        logger.error(f"Error getting media URL for post {post['id']}: {e}")
        return None
    finally:
        put_db_conn(conn)

async def store_embedding(content_id: str, client_id: str, embedding: List[float]):
    conn = await get_db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE instagram_posts SET embedding = %s, embedding_model = %s, embedded_at = NOW() WHERE id = %s AND client_id = %s",
                (embedding, 'embedding-001', content_id, client_id)
            )
            conn.commit()
    except Exception as e:
        conn.rollback()
        logger.error(f"Error storing embedding for {content_id}: {e}")
        raise
    finally:
        put_db_conn(conn)

async def store_transcript(content_id: str, client_id: str, transcript: Optional[str], has_audio: bool, audio_language: str = 'en'):
    conn = await get_db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE instagram_posts
                SET transcript = %s, has_audio = %s, audio_language = %s
                WHERE id = %s AND client_id = %s
                """,
                (transcript, has_audio, audio_language, content_id, client_id)
            )
            conn.commit()
    except Exception as e:
        conn.rollback()
        logger.error(f"Error storing transcript for {content_id}: {e}")
        raise
    finally:
        put_db_conn(conn)

async def mark_job_completed(job_id: int):
    conn = await get_db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE enrichment_jobs SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = %s", (job_id,))
            conn.commit()
    except Exception as e:
        conn.rollback()
        logger.error(f"Error marking job {job_id} completed: {e}")
        raise
    finally:
        put_db_conn(conn)

async def mark_job_failed(job_id: int, error_message: str, current_attempts: int):
    conn = await get_db_conn()
    try:
        with conn.cursor() as cur:
            next_attempt = current_attempts + 1
            if next_attempt >= MAX_RETRY_ATTEMPTS:
                cur.execute("UPDATE enrichment_jobs SET status = 'failed', error_message = %s, attempts = %s, updated_at = NOW() WHERE id = %s",
                            (error_message, next_attempt, job_id))
            else:
                backoff_minutes = RETRY_BACKOFF_MINUTES[next_attempt - 1] if next_attempt - 1 < len(RETRY_BACKOFF_MINUTES) else RETRY_BACKOFF_MINUTES[-1]
                cur.execute("UPDATE enrichment_jobs SET status = 'pending', error_message = %s, attempts = %s, updated_at = NOW(), created_at = NOW() + INTERVAL '%s minutes' WHERE id = %s",
                            (error_message, next_attempt, backoff_minutes, job_id))
            conn.commit()
    except Exception as e:
        conn.rollback()
        logger.error(f"Error marking job {job_id} failed: {e}")
        raise
    finally:
        put_db_conn(conn)

async def process_job(job: Dict[str, Any]):
    job_id = job['id']
    client_id = job['client_id']
    content_id = job['content_id']
    content_type = job['content_type']
    attempts = job['attempts']

    logger.info(f"Processing multimodal enrichment job {job_id} for {content_type}/{content_id}")

    video_path = None
    audio_path = None
    chunk_paths = []

    try:
        post = await fetch_content(content_type, content_id, client_id)
        media_type = post['media_type']

        # ============================================================
        # HANDLE VIDEO POSTS WITH AUDIO TRANSCRIPTION (PHASE 4)
        # ============================================================
        if media_type == 'VIDEO':
            logger.info(f"Processing VIDEO post {content_id} with audio transcription")

            # Step 1: Download video and extract audio
            video_data = process_video_for_transcription(post['media_url'])
            video_path = video_data['video_path']
            audio_path = video_data['audio_path']
            has_audio = video_data['has_audio']

            # Step 2: Transcribe audio (if exists)
            # For videos <=60s: direct transcription
            # For videos >60s: split into chunks and transcribe each
            transcript = None
            chunk_paths = []
            if has_audio:
                try:
                    if video_data['duration_seconds'] <= 60:
                        # Short video: direct transcription
                        logger.info(f"Transcribing audio for {content_id} ({video_data['duration_seconds']:.1f}s)")
                        transcript = transcribe_audio(audio_path, language='en')
                        logger.info(f"Transcript generated ({len(transcript)} chars): {transcript[:100]}...")
                    else:
                        # Long video: chunk and transcribe
                        logger.info(f"Transcribing long audio for {content_id} ({video_data['duration_seconds']:.1f}s) - using chunking")
                        chunk_paths = split_audio_into_chunks(audio_path, chunk_duration_seconds=50)
                        transcript = transcribe_long_audio(chunk_paths, language='en')
                        logger.info(f"Transcript generated from {len(chunk_paths)} chunks ({len(transcript)} chars): {transcript[:100]}...")
                except Exception as e:
                    logger.error(f"Transcription failed for {content_id}: {e}")
                    # Continue with visual-only embedding if transcription fails
                    transcript = None

            # Step 3: Store transcript in database
            await store_transcript(content_id, client_id, transcript, has_audio, audio_language='en')

            # Step 4: Combine caption + transcript for contextual text
            contextual_text = post['caption'] or ''
            if transcript:
                contextual_text += f" {transcript}"
                logger.debug(f"Combined contextual text: {len(contextual_text)} chars")

            # Step 5: Generate embedding using thumbnail + combined text
            # (Using existing generate_multimodal_embedding - NO CHANGES to embedder.py!)
            embedding = generate_multimodal_embedding(contextual_text, post['thumbnail_url'])
            logger.debug(f"Generated multimodal embedding for VIDEO {post['id']} with dimensions {len(embedding)}")

        # ============================================================
        # HANDLE IMAGE POSTS (UNCHANGED - PHASE 1 CODE)
        # ============================================================
        elif media_type == 'IMAGE':
            media_url = post['media_url']
            embedding = generate_multimodal_embedding(post['caption'] or '', media_url)
            logger.debug(f"Generated multimodal embedding for IMAGE {post['id']} with dimensions {len(embedding)}")

        # ============================================================
        # HANDLE CAROUSEL POSTS (UNCHANGED - PHASE 3 CODE)
        # ============================================================
        elif media_type == 'CAROUSEL_ALBUM':
            media_url = await get_primary_media_url(post, client_id)
            if not media_url:
                logger.warning(f"No primary media URL found for CAROUSEL {post['id']}, skipping embedding.")
                await mark_job_completed(job_id)
                return

            embedding = generate_multimodal_embedding(post['caption'] or '', media_url)
            logger.debug(f"Generated multimodal embedding for CAROUSEL {post['id']} with dimensions {len(embedding)}")

        else:
            raise Exception(f"Unsupported media type: {media_type}")

        # Store embedding and mark job completed
        await store_embedding(content_id, client_id, embedding)
        await mark_job_completed(job_id)
        logger.info(f"Multimodal enrichment job {job_id} completed successfully.")

    except Exception as e:
        logger.error(f"Multimodal enrichment job {job_id} failed: {e}", exc_info=True)
        await mark_job_failed(job_id, str(e), attempts)

    finally:
        # Always cleanup temp files (for VIDEO processing)
        files_to_cleanup = [video_path, audio_path] + chunk_paths
        if any(files_to_cleanup):
            cleanup_temp_files(files_to_cleanup)

# ============================================================================
# MAIN LOOP
# ============================================================================

async def poll_and_process():
    logger.info("Starting enrichment worker polling loop.")
    while True:
        try:
            job = await get_next_job()
            if job:
                await process_job(job)
            else:
                await asyncio.sleep(POLL_INTERVAL_MS / 1000.0)
        except asyncio.CancelledError:
            logger.info("Polling loop cancelled.")
            break
        except Exception as e:
            logger.error(f"Error in polling loop: {e}", exc_info=True)
            await asyncio.sleep(POLL_INTERVAL_MS / 1000.0 * 2) # Exponential backoff on loop error

# ============================================================================
# STARTUP & SHUTDOWN
# ============================================================================

async def main():
    logger.info("Multimodal Enrichment Worker starting...")
    
    # Test DB connection on startup
    conn = None
    try:
        conn = await get_db_conn()
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
        logger.info("PostgreSQL connection successful.")
    except Exception as e:
        logger.critical(f"PostgreSQL connection failed during startup: {e}")
        exit(1)
    finally:
        if conn: put_db_conn(conn)

    if not os.getenv("GOOGLE_API_KEY"):
        logger.critical("GOOGLE_API_KEY environment variable is not set. Exiting.")
        exit(1)

    # Start the polling loop
    await poll_and_process()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Enrichment worker shut down by user.")
    except Exception as e:
        logger.critical(f"Fatal error during worker startup or execution: {e}", exc_info=True)
        exit(1)
