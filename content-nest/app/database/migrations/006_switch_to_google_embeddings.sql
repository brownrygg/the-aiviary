-- ============================================================================
-- SWITCH TO GOOGLE EMBEDDINGS SCHEMA
-- Version: 006
-- Description: Alters the embedding vector dimensions to match Google's
-- text-embedding-004 model (768 dimensions) and updates related functions.
-- This is a critical step for refactoring the system to use Google Gemini.
-- ============================================================================

-- ============================================================================
-- 1. ALTER EMBEDDING COLUMN DIMENSIONS
-- ============================================================================

-- Drop the existing HNSW index before altering the column
DROP INDEX IF EXISTS idx_instagram_posts_embedding_hnsw;

-- Alter the vector dimension from 1408 (OpenAI) to 768 (Google)
ALTER TABLE instagram_posts
    ALTER COLUMN embedding TYPE vector(768);

-- Update the embedding model default value
ALTER TABLE instagram_posts
    ALTER COLUMN embedding_model SET DEFAULT 'text-embedding-004';

-- Recreate the HNSW index with the new dimensions
CREATE INDEX idx_instagram_posts_embedding_hnsw
    ON instagram_posts
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

COMMENT ON COLUMN instagram_posts.embedding IS 'AI-generated semantic embedding (768 dimensions, from Google text-embedding-004)';

-- ============================================================================
-- 2. UPDATE HELPER FUNCTION FOR NEW DIMENSIONS
-- ============================================================================

-- This function must be updated to accept a 768-dimension vector
CREATE OR REPLACE FUNCTION find_similar_posts(
    query_embedding vector(768), -- Updated dimension
    similarity_threshold FLOAT DEFAULT 0.7,
    result_limit INTEGER DEFAULT 10,
    search_client_id VARCHAR(255) DEFAULT 'client'
)
RETURNS TABLE (
    post_id VARCHAR(255),
    media_type VARCHAR(50),
    "timestamp" TIMESTAMP WITH TIME ZONE,
    similarity_score FLOAT,
    caption TEXT,
    permalink TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.id,
        p.media_type,
        p.timestamp,
        1 - (p.embedding <=> query_embedding) AS similarity_score,
        p.caption,
        p.permalink
    FROM instagram_posts p
    WHERE
        p.client_id = search_client_id
        AND p.embedding IS NOT NULL
        AND (1 - (p.embedding <=> query_embedding)) >= similarity_threshold
    ORDER BY p.embedding <=> query_embedding
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- NOTE: The migration for ad_campaigns and ads embeddings is intentionally
-- omitted here to focus the fix on the core instagram_posts functionality.
-- The same ALTER statements would be required for those tables if they
-- were part of the active embedding flow.
-- ============================================================================

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
