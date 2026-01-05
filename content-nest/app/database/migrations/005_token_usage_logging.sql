-- Migration 005: Token usage logging
-- Created: 2026-01-04
-- Purpose: Track Claude API token usage for cost monitoring and optimization

-- Create token_usage_log table
CREATE TABLE IF NOT EXISTS token_usage_log (
    id SERIAL PRIMARY KEY,
    client_id VARCHAR(255) NOT NULL DEFAULT 'client',
    session_id VARCHAR(255),  -- OpenWebUI session/chat ID if available
    timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
    model_name VARCHAR(100) NOT NULL,

    -- Token counts
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    total_tokens INTEGER NOT NULL,

    -- Cache usage (if using prompt caching)
    cache_creation_input_tokens INTEGER DEFAULT 0,
    cache_read_input_tokens INTEGER DEFAULT 0,

    -- Request metadata
    tool_calls_count INTEGER DEFAULT 0,
    stop_reason VARCHAR(50),
    user_message_preview TEXT,  -- First 200 chars of user message

    -- Cost tracking (optional, can be calculated)
    estimated_cost_usd DECIMAL(10, 6),

    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_token_usage_client_timestamp ON token_usage_log(client_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_token_usage_session ON token_usage_log(session_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_timestamp ON token_usage_log(timestamp DESC);

-- Add comments
COMMENT ON TABLE token_usage_log IS 'Logs Claude API token usage for cost monitoring and optimization';
COMMENT ON COLUMN token_usage_log.cache_creation_input_tokens IS 'Tokens used to create prompt cache (charged at higher rate)';
COMMENT ON COLUMN token_usage_log.cache_read_input_tokens IS 'Tokens read from prompt cache (discounted rate)';
COMMENT ON COLUMN token_usage_log.tool_calls_count IS 'Number of tool use iterations in this conversation';
COMMENT ON COLUMN token_usage_log.estimated_cost_usd IS 'Estimated cost in USD based on model pricing';

-- Create view for daily token usage summary
CREATE OR REPLACE VIEW daily_token_usage AS
SELECT
    client_id,
    DATE(timestamp) as usage_date,
    model_name,
    COUNT(*) as request_count,
    SUM(input_tokens) as total_input_tokens,
    SUM(output_tokens) as total_output_tokens,
    SUM(total_tokens) as total_tokens,
    SUM(cache_creation_input_tokens) as total_cache_creation_tokens,
    SUM(cache_read_input_tokens) as total_cache_read_tokens,
    SUM(tool_calls_count) as total_tool_calls,
    ROUND(AVG(input_tokens)::numeric, 2) as avg_input_tokens,
    ROUND(AVG(output_tokens)::numeric, 2) as avg_output_tokens,
    SUM(estimated_cost_usd) as estimated_daily_cost_usd
FROM token_usage_log
GROUP BY client_id, DATE(timestamp), model_name
ORDER BY usage_date DESC, model_name;

COMMENT ON VIEW daily_token_usage IS 'Daily aggregated token usage statistics per client and model';

-- Create helper function to get token usage stats
CREATE OR REPLACE FUNCTION get_token_usage_stats(
    p_client_id VARCHAR DEFAULT 'client',
    p_days INTEGER DEFAULT 30
)
RETURNS TABLE (
    period VARCHAR,
    total_requests BIGINT,
    total_input_tokens BIGINT,
    total_output_tokens BIGINT,
    total_tokens BIGINT,
    avg_tokens_per_request NUMERIC,
    total_tool_calls BIGINT,
    estimated_cost_usd NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        'Last ' || p_days || ' days' as period,
        COUNT(*)::BIGINT as total_requests,
        SUM(input_tokens)::BIGINT as total_input_tokens,
        SUM(output_tokens)::BIGINT as total_output_tokens,
        SUM(total_tokens)::BIGINT as total_tokens,
        ROUND(AVG(total_tokens)::numeric, 2) as avg_tokens_per_request,
        SUM(tool_calls_count)::BIGINT as total_tool_calls,
        ROUND(SUM(estimated_cost_usd)::numeric, 2) as estimated_cost_usd
    FROM token_usage_log
    WHERE client_id = p_client_id
      AND timestamp >= CURRENT_DATE - p_days;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_token_usage_stats IS 'Get aggregated token usage statistics for a time period';
