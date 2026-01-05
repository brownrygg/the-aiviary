-- ============================================================================
-- PGVECTOR ENRICHMENT SCHEMA
-- Version: 004
-- Description: Enable pgvector extension and add embedding support for semantic search
-- ============================================================================

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- ENRICHMENT JOB QUEUE
-- ============================================================================

-- Track embedding generation jobs
CREATE TABLE IF NOT EXISTS enrichment_jobs (
    id SERIAL PRIMARY KEY,
    client_id VARCHAR(255) NOT NULL,
    content_id VARCHAR(255) NOT NULL,
    content_type VARCHAR(100) NOT NULL, -- 'instagram_posts', 'ad_campaigns', etc.
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, processing, completed, failed
    attempts INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Prevent duplicate jobs
    UNIQUE(client_id, content_id, content_type)
);

-- Index for job processing queries
CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_status
    ON enrichment_jobs(status, created_at);

CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_client
    ON enrichment_jobs(client_id, status);

-- ============================================================================
-- ADD EMBEDDING COLUMNS TO CONTENT TABLES
-- ============================================================================

-- Instagram posts embeddings (text-embedding-3-small = 1408 dimensions)
ALTER TABLE instagram_posts
    ADD COLUMN IF NOT EXISTS embedding vector(1408),
    ADD COLUMN IF NOT EXISTS embedding_model VARCHAR(100) DEFAULT 'text-embedding-3-small',
    ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMP WITH TIME ZONE;

-- Create HNSW index for fast vector similarity search
-- m=16 (connections per layer), ef_construction=64 (build quality)
CREATE INDEX IF NOT EXISTS idx_instagram_posts_embedding_hnsw
    ON instagram_posts
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Index for filtering embedded vs non-embedded posts
CREATE INDEX IF NOT EXISTS idx_instagram_posts_embedded
    ON instagram_posts(client_id, embedded_at)
    WHERE embedding IS NOT NULL;

-- ============================================================================
-- FUTURE-PROOF: Add embedding columns to other content tables
-- ============================================================================

-- Ad campaigns embeddings (for campaign descriptions, objectives)
ALTER TABLE ad_campaigns
    ADD COLUMN IF NOT EXISTS embedding vector(1408),
    ADD COLUMN IF NOT EXISTS embedding_model VARCHAR(100) DEFAULT 'text-embedding-3-small',
    ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_ad_campaigns_embedding_hnsw
    ON ad_campaigns
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Individual ads embeddings (for ad creative text)
ALTER TABLE ads
    ADD COLUMN IF NOT EXISTS embedding vector(1408),
    ADD COLUMN IF NOT EXISTS embedding_model VARCHAR(100) DEFAULT 'text-embedding-3-small',
    ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_ads_embedding_hnsw
    ON ads
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- ============================================================================
-- HELPER FUNCTIONS FOR SEMANTIC SEARCH
-- ============================================================================

-- Function to find similar Instagram posts by embedding
-- Returns posts with similarity score (0-1, higher is more similar)
CREATE OR REPLACE FUNCTION find_similar_posts(
    query_embedding vector(1408),
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

-- Function to get embedding generation progress
CREATE OR REPLACE FUNCTION get_embedding_progress(
    search_client_id VARCHAR(255) DEFAULT 'client'
)
RETURNS TABLE (
    content_type VARCHAR(100),
    total_items BIGINT,
    embedded_items BIGINT,
    pending_jobs BIGINT,
    failed_jobs BIGINT,
    completion_percentage NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        'instagram_posts' AS content_type,
        COUNT(*)::BIGINT AS total_items,
        COUNT(embedding)::BIGINT AS embedded_items,
        (SELECT COUNT(*)::BIGINT FROM enrichment_jobs
         WHERE client_id = search_client_id
         AND content_type = 'instagram_posts'
         AND status = 'pending') AS pending_jobs,
        (SELECT COUNT(*)::BIGINT FROM enrichment_jobs
         WHERE client_id = search_client_id
         AND content_type = 'instagram_posts'
         AND status = 'failed') AS failed_jobs,
        ROUND((COUNT(embedding)::NUMERIC / NULLIF(COUNT(*), 0) * 100), 2) AS completion_percentage
    FROM instagram_posts
    WHERE client_id = search_client_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE enrichment_jobs IS 'Queue for AI embedding generation jobs';
COMMENT ON COLUMN instagram_posts.embedding IS 'AI-generated semantic embedding (1408 dimensions, text-embedding-3-small)';
COMMENT ON FUNCTION find_similar_posts IS 'Find semantically similar Instagram posts using vector similarity';
COMMENT ON FUNCTION get_embedding_progress IS 'Get embedding generation progress statistics';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- This migration adds pgvector support for semantic search across Instagram and ad content.
-- Embeddings are generated asynchronously by the enrichment-worker service.
-- ============================================================================
