-- ============================================================================
-- REMOVE LARGE TEXT FIELDS FROM HELPER FUNCTIONS - MIGRATION 003
-- Description: Removes caption and permalink from get_top_posts functions to
--              prevent massive token usage. Returns ONLY metrics, not raw data.
-- ============================================================================

-- Drop old versions (required to change return type)
DROP FUNCTION IF EXISTS get_top_posts(VARCHAR, TEXT, INT, INT);
DROP FUNCTION IF EXISTS get_top_posts_adaptive(VARCHAR, TEXT, INT, INT);

-- Fixed version: Get top posts (ORIGINAL - NO CAPTION, NO PERMALINK)
CREATE OR REPLACE FUNCTION get_top_posts(
    p_client_id VARCHAR(255),
    p_metric TEXT, -- 'views', 'reach', 'saved', 'total_interactions', 'engagement_rate'
    p_limit INT DEFAULT 10,
    p_days INT DEFAULT 30
)
RETURNS TABLE(
    post_id VARCHAR(255),
    media_type VARCHAR(50),
    post_timestamp TIMESTAMP WITH TIME ZONE,
    metric_value BIGINT,
    engagement_rate DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ip.id,
        ip.media_type,
        ip.timestamp,
        CASE
            WHEN p_metric = 'views' THEN pii.views
            WHEN p_metric = 'reach' THEN pii.reach
            WHEN p_metric = 'saved' THEN pii.saved
            WHEN p_metric = 'total_interactions' THEN pii.total_interactions
            ELSE pii.total_interactions
        END as metric_value,
        CASE
            WHEN pii.reach > 0 THEN
                ROUND((pii.total_interactions::DECIMAL / pii.reach::DECIMAL) * 100, 2)
            ELSE 0
        END as engagement_rate
    FROM instagram_posts ip
    JOIN instagram_post_insights pii ON ip.id = pii.post_id
    WHERE ip.client_id = p_client_id
      AND ip.timestamp >= CURRENT_DATE - p_days
      AND ip.is_deleted = FALSE
      AND pii.snapshot_date = (
          SELECT MAX(snapshot_date)
          FROM instagram_post_insights
          WHERE post_id = ip.id
      )
    ORDER BY
        CASE
            WHEN p_metric = 'views' THEN pii.views
            WHEN p_metric = 'reach' THEN pii.reach
            WHEN p_metric = 'saved' THEN pii.saved
            WHEN p_metric = 'total_interactions' THEN pii.total_interactions
            ELSE pii.total_interactions
        END DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Fixed version: Get top posts (ADAPTIVE - NO CAPTION, NO PERMALINK)
CREATE OR REPLACE FUNCTION get_top_posts_adaptive(
    p_client_id VARCHAR(255),
    p_metric TEXT DEFAULT 'reach',
    p_limit INT DEFAULT 10,
    p_days INT DEFAULT 30
)
RETURNS TABLE(
    post_id VARCHAR(255),
    media_type VARCHAR(50),
    post_timestamp TIMESTAMP WITH TIME ZONE,
    metric_value BIGINT,
    engagement_rate DECIMAL,
    data_availability_status TEXT,
    actual_date_range_days INTEGER,
    total_posts_in_range INTEGER
) AS $$
DECLARE
    v_availability RECORD;
    v_actual_start_date DATE;
    v_actual_end_date DATE;
    v_posts_in_range INTEGER;
BEGIN
    -- Check data availability
    SELECT * INTO v_availability
    FROM get_client_data_availability(p_client_id);

    -- Return early if no data
    IF NOT v_availability.has_posts OR NOT v_availability.has_insights THEN
        RETURN QUERY
        SELECT
            NULL::VARCHAR(255),
            NULL::VARCHAR(50),
            NULL::TIMESTAMP WITH TIME ZONE,
            0::BIGINT,
            0::DECIMAL,
            CASE
                WHEN NOT v_availability.backfill_completed THEN 'Backfill not completed'
                WHEN NOT v_availability.has_posts THEN 'No posts found'
                WHEN NOT v_availability.has_insights THEN 'No insights found'
                ELSE 'Unknown error'
            END::TEXT,
            0,
            0
        LIMIT 1;
        RETURN;
    END IF;

    -- Calculate actual date range
    v_actual_start_date := GREATEST(
        CURRENT_DATE - p_days,
        v_availability.earliest_post_date
    );
    v_actual_end_date := CURRENT_DATE;

    -- Count posts in range
    SELECT COUNT(*) INTO v_posts_in_range
    FROM instagram_posts
    WHERE client_id = p_client_id
      AND timestamp >= v_actual_start_date
      AND timestamp <= v_actual_end_date
      AND is_deleted = FALSE;

    -- Return data if exists
    IF v_posts_in_range > 0 THEN
        RETURN QUERY
        SELECT
            ip.id,
            ip.media_type,
            ip.timestamp,
            CASE
                WHEN p_metric = 'views' THEN pii.views
                WHEN p_metric = 'reach' THEN pii.reach
                WHEN p_metric = 'saved' THEN pii.saved
                WHEN p_metric = 'total_interactions' THEN pii.total_interactions
                ELSE pii.total_interactions
            END as metric_value,
            CASE
                WHEN pii.reach > 0 THEN
                    ROUND((pii.total_interactions::DECIMAL / pii.reach::DECIMAL) * 100, 2)
                ELSE 0
            END as engagement_rate,
            CASE
                WHEN v_actual_start_date > (CURRENT_DATE - p_days) THEN
                    FORMAT('Data available from %s (requested %s days, have %s days)',
                           v_actual_start_date, p_days, v_availability.days_of_post_data)
                ELSE
                    FORMAT('Full data range available (%s days)', v_availability.days_of_post_data)
            END::TEXT,
            (v_actual_end_date - v_actual_start_date),
            v_posts_in_range
        FROM instagram_posts ip
        JOIN instagram_post_insights pii ON ip.id = pii.post_id
        WHERE ip.client_id = p_client_id
          AND ip.timestamp >= v_actual_start_date
          AND ip.timestamp <= v_actual_end_date
          AND ip.is_deleted = FALSE
          AND pii.snapshot_date = (
              SELECT MAX(snapshot_date)
              FROM instagram_post_insights
              WHERE instagram_post_insights.post_id = ip.id
          )
        ORDER BY
            CASE
                WHEN p_metric = 'views' THEN pii.views
                WHEN p_metric = 'reach' THEN pii.reach
                WHEN p_metric = 'saved' THEN pii.saved
                WHEN p_metric = 'total_interactions' THEN pii.total_interactions
                ELSE pii.total_interactions
            END DESC
        LIMIT p_limit;
    ELSE
        RETURN QUERY
        SELECT
            NULL::VARCHAR(255),
            NULL::VARCHAR(50),
            NULL::TIMESTAMP WITH TIME ZONE,
            0::BIGINT,
            0::DECIMAL,
            FORMAT('No posts found in last %s days. Available data: %s to %s (%s posts total)',
                   p_days, v_availability.earliest_post_date, v_availability.latest_post_date,
                   v_availability.total_posts)::TEXT,
            v_availability.days_of_post_data,
            0
        LIMIT 1;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- Add comment to track migration version
COMMENT ON FUNCTION get_top_posts IS 'Migration 003: Removed caption and permalink to reduce token usage - returns ONLY metrics';
COMMENT ON FUNCTION get_top_posts_adaptive IS 'Migration 003: Removed caption and permalink to reduce token usage - returns ONLY metrics';
