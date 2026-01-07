-- ============================================================================
-- GEMINI MULTIMODAL EMBEDDING SCHEMA
-- Version: 007
-- Description: Corrects the embedding vector dimensions to match Google's
-- new multimodal embedding-001 model (1408 dimensions). This is the final
-- and correct schema for true multimodal embedding.
-- ============================================================================

-- ============================================================================
-- 1. REVERT EMBEDDING COLUMN DIMENSIONS TO 1408
-- ============================================================================

-- Drop the incorrect index based on 768 dimensions
DROP INDEX IF EXISTS idx_instagram_posts_embedding_hnsw;

-- Alter the vector dimension back to 1408 for the new multimodal model
ALTER TABLE instagram_posts
    ALTER COLUMN embedding TYPE vector(1408);

-- Update the embedding model default value to the correct model
ALTER TABLE instagram_posts
    ALTER COLUMN embedding_model SET DEFAULT 'embedding-001';

-- Recreate the HNSW index with the correct 1408 dimensions
CREATE INDEX idx_instagram_posts_embedding_hnsw
    ON instagram_posts
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

COMMENT ON COLUMN instagram_posts.embedding IS 'AI-generated multimodal embedding (1408 dimensions, from Google embedding-001)';

-- ============================================================================
-- 2. UPDATE HELPER FUNCTION FOR 1408 DIMENSIONS
-- ============================================================================

-- This function must be updated to accept a 1408-dimension vector
CREATE OR REPLACE FUNCTION find_similar_posts(
    query_embedding vector(1408), -- Updated dimension
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
-- 3. REMOVE VISION DESCRIPTION COLUMN
-- ============================================================================
-- The vision description is no longer needed as the embedding itself is multimodal.
-- This simplifies the schema and the application logic.

ALTER TABLE instagram_posts
    DROP COLUMN IF EXISTS vision_description;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
