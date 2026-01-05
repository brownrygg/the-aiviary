-- Migration 004: Add transcript columns for video audio transcription
-- Created: 2026-01-04
-- Purpose: Support Phase 4 audio transcription feature

-- Add transcript columns to instagram_posts
ALTER TABLE instagram_posts ADD COLUMN IF NOT EXISTS transcript TEXT;
ALTER TABLE instagram_posts ADD COLUMN IF NOT EXISTS has_audio BOOLEAN DEFAULT FALSE;
ALTER TABLE instagram_posts ADD COLUMN IF NOT EXISTS audio_language VARCHAR(10) DEFAULT 'en';

-- Create index for transcript search (GIN index for full-text search)
CREATE INDEX IF NOT EXISTS idx_instagram_posts_transcript ON instagram_posts USING gin(to_tsvector('english', COALESCE(transcript, '')));

-- Add comments for documentation
COMMENT ON COLUMN instagram_posts.transcript IS 'Speech-to-text transcript from video audio (Google Cloud Speech-to-Text V2 Chirp model)';
COMMENT ON COLUMN instagram_posts.has_audio IS 'True if video has audio track, false if silent/no audio detected';
COMMENT ON COLUMN instagram_posts.audio_language IS 'Detected language code (en, es, etc.) from audio transcription';
