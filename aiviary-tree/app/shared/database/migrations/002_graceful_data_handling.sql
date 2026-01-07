-- ============================================================================
-- GRACEFUL DATA HANDLING - MIGRATION 002
-- Description: Adds adaptive versions of all helper functions with automatic
--              date range adjustment and clear status messages when data is missing
-- ============================================================================

-- ============================================================================
-- UTILITY FUNCTIONS - CORE DATA AVAILABILITY
-- ============================================================================

-- Check what data is available for a client
CREATE OR REPLACE FUNCTION get_client_data_availability(p_client_id VARCHAR(255))
RETURNS TABLE(
    has_posts BOOLEAN,
    has_insights BOOLEAN,
    has_follower_history BOOLEAN,
    has_ad_campaigns BOOLEAN,
    earliest_post_date DATE,
    latest_post_date DATE,
    earliest_insight_date DATE,
    latest_insight_date DATE,
    earliest_follower_date DATE,
    latest_follower_date DATE,
    earliest_campaign_date DATE,
    latest_campaign_date DATE,
    total_posts BIGINT,
    total_insights BIGINT,
    total_campaigns BIGINT,
    backfill_completed BOOLEAN,
    days_of_post_data INTEGER,
    days_of_insight_data INTEGER
) AS $$
BEGIN
    RETURN QUERY
    WITH post_data AS (
        SELECT
            MIN(timestamp)::DATE as earliest_post,
            MAX(timestamp)::DATE as latest_post,
            COUNT(*) as post_count
        FROM instagram_posts
        WHERE client_id = p_client_id
          AND is_deleted = FALSE
    ),
    insight_data AS (
        SELECT
            MIN(snapshot_date) as earliest_insight,
            MAX(snapshot_date) as latest_insight,
            COUNT(*) as insight_count
        FROM instagram_post_insights
        WHERE client_id = p_client_id
    ),
    follower_data AS (
        SELECT
            MIN(snapshot_date) as earliest_follower,
            MAX(snapshot_date) as latest_follower
        FROM instagram_follower_history
        WHERE client_id = p_client_id
    ),
    campaign_data AS (
        SELECT
            MIN(start_time)::DATE as earliest_campaign,
            MAX(COALESCE(stop_time, CURRENT_TIMESTAMP))::DATE as latest_campaign,
            COUNT(*) as campaign_count
        FROM ad_campaigns
        WHERE client_id = p_client_id
          AND is_deleted = FALSE
    ),
    sync_data AS (
        SELECT sync_status.backfill_completed
        FROM sync_status
        WHERE client_id = p_client_id
    )
    SELECT
        (pd.post_count > 0) as has_posts,
        (id.insight_count > 0) as has_insights,
        (fd.earliest_follower IS NOT NULL) as has_follower_history,
        (cd.campaign_count > 0) as has_ad_campaigns,
        pd.earliest_post,
        pd.latest_post,
        id.earliest_insight,
        id.latest_insight,
        fd.earliest_follower,
        fd.latest_follower,
        cd.earliest_campaign,
        cd.latest_campaign,
        pd.post_count,
        id.insight_count,
        cd.campaign_count,
        COALESCE(sd.backfill_completed, FALSE),
        CASE
            WHEN pd.latest_post IS NOT NULL AND pd.earliest_post IS NOT NULL
            THEN (pd.latest_post - pd.earliest_post)
            ELSE 0
        END as days_of_post_data,
        CASE
            WHEN id.latest_insight IS NOT NULL AND id.earliest_insight IS NOT NULL
            THEN (id.latest_insight - id.earliest_insight)
            ELSE 0
        END as days_of_insight_data
    FROM post_data pd
    CROSS JOIN insight_data id
    CROSS JOIN follower_data fd
    CROSS JOIN campaign_data cd
    LEFT JOIN sync_data sd ON TRUE;
END;
$$ LANGUAGE plpgsql;

-- Adjust date range to available data
CREATE OR REPLACE FUNCTION adjust_date_range(
    p_client_id VARCHAR(255),
    p_requested_start DATE,
    p_requested_end DATE
)
RETURNS TABLE(
    adjusted_start DATE,
    adjusted_end DATE,
    was_adjusted BOOLEAN,
    adjustment_reason TEXT,
    days_available INTEGER
) AS $$
DECLARE
    v_earliest_date DATE;
    v_latest_date DATE;
    v_adjusted_start DATE;
    v_adjusted_end DATE;
    v_was_adjusted BOOLEAN := FALSE;
    v_reason TEXT := NULL;
BEGIN
    -- Get actual available date range
    SELECT earliest_post_date, latest_post_date
    INTO v_earliest_date, v_latest_date
    FROM get_client_data_availability(p_client_id);

    -- Handle no data case
    IF v_earliest_date IS NULL OR v_latest_date IS NULL THEN
        RETURN QUERY
        SELECT
            NULL::DATE,
            NULL::DATE,
            TRUE,
            'No data available for this client'::TEXT,
            0;
        RETURN;
    END IF;

    -- Initialize adjusted dates
    v_adjusted_start := p_requested_start;
    v_adjusted_end := p_requested_end;

    -- Adjust start date if before available data
    IF p_requested_start < v_earliest_date THEN
        v_adjusted_start := v_earliest_date;
        v_was_adjusted := TRUE;
        v_reason := FORMAT('Start date adjusted from %s to %s (earliest available)',
                          p_requested_start, v_earliest_date);
    END IF;

    -- Adjust end date if after available data
    IF p_requested_end > v_latest_date THEN
        v_adjusted_end := v_latest_date;
        v_was_adjusted := TRUE;
        v_reason := COALESCE(v_reason || '; ', '') ||
                   FORMAT('End date adjusted from %s to %s (latest available)',
                         p_requested_end, v_latest_date);
    END IF;

    -- Handle inverted range
    IF v_adjusted_start > v_adjusted_end THEN
        RETURN QUERY
        SELECT
            v_earliest_date,
            v_latest_date,
            TRUE,
            'Requested range not available; using full available range'::TEXT,
            (v_latest_date - v_earliest_date);
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        v_adjusted_start,
        v_adjusted_end,
        v_was_adjusted,
        COALESCE(v_reason, 'No adjustment needed'),
        (v_adjusted_end - v_adjusted_start);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- PERFORMANCE TRACKING - ADAPTIVE VERSIONS
-- ============================================================================

-- Adaptive version: Get total reach
CREATE OR REPLACE FUNCTION get_total_reach_adaptive(
    p_client_id VARCHAR(255),
    p_start_date DATE,
    p_end_date DATE
)
RETURNS TABLE(
    total_reach BIGINT,
    actual_start_date DATE,
    actual_end_date DATE,
    was_adjusted BOOLEAN,
    status_message TEXT
) AS $$
DECLARE
    v_availability RECORD;
    v_adj_range RECORD;
    v_reach BIGINT;
BEGIN
    -- Check data availability
    SELECT * INTO v_availability
    FROM get_client_data_availability(p_client_id);

    IF NOT v_availability.has_posts OR NOT v_availability.has_insights THEN
        RETURN QUERY
        SELECT
            0::BIGINT,
            NULL::DATE,
            NULL::DATE,
            FALSE,
            CASE
                WHEN NOT v_availability.backfill_completed THEN 'Backfill not completed'
                WHEN NOT v_availability.has_posts THEN 'No posts found'
                WHEN NOT v_availability.has_insights THEN 'No insights found'
                ELSE 'No data available'
            END::TEXT;
        RETURN;
    END IF;

    -- Adjust date range
    SELECT * INTO v_adj_range
    FROM adjust_date_range(p_client_id, p_start_date, p_end_date);

    IF v_adj_range.adjusted_start IS NULL THEN
        RETURN QUERY
        SELECT
            0::BIGINT,
            NULL::DATE,
            NULL::DATE,
            TRUE,
            v_adj_range.adjustment_reason::TEXT;
        RETURN;
    END IF;

    -- Calculate reach
    SELECT COALESCE(SUM(DISTINCT pii.reach), 0)
    INTO v_reach
    FROM instagram_posts ip
    JOIN instagram_post_insights pii ON ip.id = pii.post_id
    WHERE ip.client_id = p_client_id
      AND ip.timestamp::DATE BETWEEN v_adj_range.adjusted_start AND v_adj_range.adjusted_end
      AND ip.is_deleted = FALSE
      AND pii.snapshot_date = (
          SELECT MAX(snapshot_date)
          FROM instagram_post_insights
          WHERE post_id = ip.id
      );

    RETURN QUERY
    SELECT
        v_reach,
        v_adj_range.adjusted_start,
        v_adj_range.adjusted_end,
        v_adj_range.was_adjusted,
        CASE
            WHEN v_adj_range.was_adjusted THEN v_adj_range.adjustment_reason
            ELSE FORMAT('Total reach calculated for %s posts',
                       (SELECT COUNT(*) FROM instagram_posts WHERE client_id = p_client_id
                        AND timestamp::DATE BETWEEN v_adj_range.adjusted_start AND v_adj_range.adjusted_end))
        END::TEXT;
END;
$$ LANGUAGE plpgsql;

-- Adaptive version: Get top posts
CREATE OR REPLACE FUNCTION get_top_posts_adaptive(
    p_client_id VARCHAR(255),
    p_metric TEXT DEFAULT 'reach',
    p_limit INT DEFAULT 10,
    p_days INT DEFAULT 30
)
RETURNS TABLE(
    post_id VARCHAR(255),
    caption TEXT,
    media_type VARCHAR(50),
    permalink TEXT,
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
            CASE
                WHEN NOT v_availability.backfill_completed THEN 'Backfill not completed - no data available yet'
                WHEN NOT v_availability.has_posts THEN 'No posts found for this client'
                WHEN NOT v_availability.has_insights THEN 'Posts exist but no insights data available'
                ELSE 'No data available for this client'
            END::TEXT,
            NULL::VARCHAR(50),
            NULL::TEXT,
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
            ip.caption,
            ip.media_type,
            ip.permalink,
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
            FORMAT('No posts found in last %s days. Available data: %s to %s (%s posts total)',
                   p_days, v_availability.earliest_post_date, v_availability.latest_post_date,
                   v_availability.total_posts)::TEXT,
            NULL::VARCHAR(50),
            NULL::TEXT,
            NULL::TIMESTAMP WITH TIME ZONE,
            0::BIGINT,
            0::DECIMAL,
            'Data exists but outside requested range'::TEXT,
            v_availability.days_of_post_data,
            0
        LIMIT 1;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Adaptive version: Get engagement rate
CREATE OR REPLACE FUNCTION get_engagement_rate_adaptive(p_post_id VARCHAR(255))
RETURNS TABLE(
    engagement_rate DECIMAL,
    reach BIGINT,
    total_interactions BIGINT,
    latest_snapshot_date DATE,
    status_message TEXT
) AS $$
DECLARE
    v_result RECORD;
BEGIN
    SELECT
        CASE
            WHEN pii.reach > 0 THEN
                ROUND((pii.total_interactions::DECIMAL / pii.reach::DECIMAL) * 100, 2)
            ELSE 0
        END as eng_rate,
        pii.reach,
        pii.total_interactions,
        pii.snapshot_date
    INTO v_result
    FROM instagram_post_insights pii
    WHERE pii.post_id = p_post_id
    ORDER BY pii.snapshot_date DESC
    LIMIT 1;

    IF v_result IS NULL THEN
        RETURN QUERY
        SELECT
            0::DECIMAL,
            0::BIGINT,
            0::BIGINT,
            NULL::DATE,
            'No insights found for this post ID'::TEXT;
    ELSE
        RETURN QUERY
        SELECT
            v_result.eng_rate,
            v_result.reach,
            v_result.total_interactions,
            v_result.snapshot_date,
            FORMAT('Engagement rate calculated from latest insights (%s)', v_result.snapshot_date)::TEXT;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Adaptive version: Compare periods
CREATE OR REPLACE FUNCTION compare_periods_adaptive(
    p_client_id VARCHAR(255),
    p_metric TEXT,
    p_period1_start DATE,
    p_period1_end DATE,
    p_period2_start DATE,
    p_period2_end DATE
)
RETURNS TABLE(
    period1_value BIGINT,
    period2_value BIGINT,
    change_absolute BIGINT,
    change_percentage DECIMAL,
    period1_adjusted BOOLEAN,
    period2_adjusted BOOLEAN,
    adjustment_notes TEXT,
    data_quality_score DECIMAL
) AS $$
DECLARE
    v_period1_adj RECORD;
    v_period2_adj RECORD;
    v_period1_val BIGINT;
    v_period2_val BIGINT;
    v_notes TEXT := '';
    v_quality_score DECIMAL;
BEGIN
    -- Adjust both periods to available data
    SELECT * INTO v_period1_adj
    FROM adjust_date_range(p_client_id, p_period1_start, p_period1_end);

    SELECT * INTO v_period2_adj
    FROM adjust_date_range(p_client_id, p_period2_start, p_period2_end);

    -- Handle no data cases
    IF v_period1_adj.adjusted_start IS NULL OR v_period2_adj.adjusted_start IS NULL THEN
        RETURN QUERY
        SELECT
            0::BIGINT,
            0::BIGINT,
            0::BIGINT,
            0::DECIMAL,
            TRUE,
            TRUE,
            COALESCE(v_period1_adj.adjustment_reason, v_period2_adj.adjustment_reason)::TEXT,
            0::DECIMAL;
        RETURN;
    END IF;

    -- Build adjustment notes
    IF v_period1_adj.was_adjusted THEN
        v_notes := 'Period 1: ' || v_period1_adj.adjustment_reason;
    END IF;

    IF v_period2_adj.was_adjusted THEN
        v_notes := v_notes || CASE WHEN v_notes != '' THEN '; ' ELSE '' END ||
                  'Period 2: ' || v_period2_adj.adjustment_reason;
    END IF;

    IF v_notes = '' THEN
        v_notes := 'No adjustments needed - full data available';
    END IF;

    -- Calculate metrics based on type
    IF p_metric = 'reach' THEN
        SELECT COALESCE(SUM(pii.reach), 0)
        INTO v_period1_val
        FROM instagram_posts ip
        JOIN instagram_post_insights pii ON ip.id = pii.post_id
        WHERE ip.client_id = p_client_id
          AND ip.timestamp::DATE BETWEEN v_period1_adj.adjusted_start AND v_period1_adj.adjusted_end
          AND ip.is_deleted = FALSE;

        SELECT COALESCE(SUM(pii.reach), 0)
        INTO v_period2_val
        FROM instagram_posts ip
        JOIN instagram_post_insights pii ON ip.id = pii.post_id
        WHERE ip.client_id = p_client_id
          AND ip.timestamp::DATE BETWEEN v_period2_adj.adjusted_start AND v_period2_adj.adjusted_end
          AND ip.is_deleted = FALSE;

    ELSIF p_metric = 'engagement' THEN
        SELECT COALESCE(SUM(pii.total_interactions), 0)
        INTO v_period1_val
        FROM instagram_posts ip
        JOIN instagram_post_insights pii ON ip.id = pii.post_id
        WHERE ip.client_id = p_client_id
          AND ip.timestamp::DATE BETWEEN v_period1_adj.adjusted_start AND v_period1_adj.adjusted_end
          AND ip.is_deleted = FALSE;

        SELECT COALESCE(SUM(pii.total_interactions), 0)
        INTO v_period2_val
        FROM instagram_posts ip
        JOIN instagram_post_insights pii ON ip.id = pii.post_id
        WHERE ip.client_id = p_client_id
          AND ip.timestamp::DATE BETWEEN v_period2_adj.adjusted_start AND v_period2_adj.adjusted_end
          AND ip.is_deleted = FALSE;

    ELSIF p_metric = 'followers' THEN
        SELECT followers_count INTO v_period1_val
        FROM instagram_follower_history
        WHERE client_id = p_client_id
          AND snapshot_date <= v_period1_adj.adjusted_end
        ORDER BY snapshot_date DESC
        LIMIT 1;

        SELECT followers_count INTO v_period2_val
        FROM instagram_follower_history
        WHERE client_id = p_client_id
          AND snapshot_date <= v_period2_adj.adjusted_end
        ORDER BY snapshot_date DESC
        LIMIT 1;
    END IF;

    -- Calculate data quality score (0-100)
    v_quality_score := 100;

    IF v_period1_adj.was_adjusted THEN
        v_quality_score := v_quality_score - 25;
    END IF;

    IF v_period2_adj.was_adjusted THEN
        v_quality_score := v_quality_score - 25;
    END IF;

    RETURN QUERY
    SELECT
        v_period1_val,
        v_period2_val,
        v_period2_val - v_period1_val as change_absolute,
        CASE
            WHEN v_period1_val > 0 THEN
                ROUND(((v_period2_val::DECIMAL - v_period1_val::DECIMAL) / v_period1_val::DECIMAL) * 100, 2)
            ELSE 0
        END as change_percentage,
        v_period1_adj.was_adjusted,
        v_period2_adj.was_adjusted,
        v_notes::TEXT,
        v_quality_score;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- CONTENT STRATEGY - ADAPTIVE VERSIONS
-- ============================================================================

-- Adaptive version: Analyze content types
CREATE OR REPLACE FUNCTION analyze_content_types_adaptive(
    p_client_id VARCHAR(255),
    p_days INT DEFAULT 30
)
RETURNS TABLE(
    media_type VARCHAR(50),
    post_count BIGINT,
    avg_reach DECIMAL,
    avg_engagement DECIMAL,
    avg_engagement_rate DECIMAL,
    total_saves BIGINT,
    status_message TEXT
) AS $$
DECLARE
    v_availability RECORD;
    v_actual_start_date DATE;
    v_posts_in_range INTEGER;
BEGIN
    SELECT * INTO v_availability
    FROM get_client_data_availability(p_client_id);

    IF NOT v_availability.has_posts OR NOT v_availability.has_insights THEN
        RETURN QUERY
        SELECT
            NULL::VARCHAR(50),
            0::BIGINT,
            0::DECIMAL,
            0::DECIMAL,
            0::DECIMAL,
            0::BIGINT,
            CASE
                WHEN NOT v_availability.backfill_completed THEN 'Backfill not completed'
                ELSE 'No posts or insights available'
            END::TEXT
        LIMIT 1;
        RETURN;
    END IF;

    v_actual_start_date := GREATEST(
        CURRENT_DATE - p_days,
        v_availability.earliest_post_date
    );

    SELECT COUNT(*) INTO v_posts_in_range
    FROM instagram_posts
    WHERE client_id = p_client_id
      AND timestamp >= v_actual_start_date
      AND is_deleted = FALSE;

    IF v_posts_in_range = 0 THEN
        RETURN QUERY
        SELECT
            NULL::VARCHAR(50),
            0::BIGINT,
            0::DECIMAL,
            0::DECIMAL,
            0::DECIMAL,
            0::BIGINT,
            FORMAT('No posts in last %s days. Available data: %s to %s',
                   p_days, v_availability.earliest_post_date, v_availability.latest_post_date)::TEXT
        LIMIT 1;
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        ip.media_type,
        COUNT(*)::BIGINT as post_count,
        ROUND(AVG(pii.reach), 2) as avg_reach,
        ROUND(AVG(pii.total_interactions), 2) as avg_engagement,
        ROUND(AVG(
            CASE
                WHEN pii.reach > 0 THEN (pii.total_interactions::DECIMAL / pii.reach::DECIMAL) * 100
                ELSE 0
            END
        ), 2) as avg_engagement_rate,
        SUM(pii.saved)::BIGINT as total_saves,
        FORMAT('Analysis based on %s posts from %s to %s',
               v_posts_in_range, v_actual_start_date, CURRENT_DATE)::TEXT
    FROM instagram_posts ip
    JOIN instagram_post_insights pii ON ip.id = pii.post_id
    WHERE ip.client_id = p_client_id
      AND ip.timestamp >= v_actual_start_date
      AND ip.is_deleted = FALSE
      AND pii.snapshot_date = (
          SELECT MAX(snapshot_date)
          FROM instagram_post_insights
          WHERE post_id = ip.id
      )
    GROUP BY ip.media_type
    ORDER BY avg_engagement_rate DESC;
END;
$$ LANGUAGE plpgsql;

-- Adaptive version: Get best posting times
CREATE OR REPLACE FUNCTION get_best_posting_times_adaptive(
    p_client_id VARCHAR(255),
    p_days INT DEFAULT 90
)
RETURNS TABLE(
    hour_of_day INTEGER,
    day_of_week INTEGER,
    post_count BIGINT,
    avg_reach DECIMAL,
    avg_engagement_rate DECIMAL,
    status_message TEXT
) AS $$
DECLARE
    v_availability RECORD;
    v_actual_start_date DATE;
    v_posts_in_range INTEGER;
BEGIN
    SELECT * INTO v_availability
    FROM get_client_data_availability(p_client_id);

    IF NOT v_availability.has_posts OR NOT v_availability.has_insights THEN
        RETURN QUERY
        SELECT
            NULL::INTEGER,
            NULL::INTEGER,
            0::BIGINT,
            0::DECIMAL,
            0::DECIMAL,
            'No data available for analysis'::TEXT
        LIMIT 1;
        RETURN;
    END IF;

    v_actual_start_date := GREATEST(
        CURRENT_DATE - p_days,
        v_availability.earliest_post_date
    );

    SELECT COUNT(*) INTO v_posts_in_range
    FROM instagram_posts
    WHERE client_id = p_client_id
      AND timestamp >= v_actual_start_date
      AND is_deleted = FALSE;

    IF v_posts_in_range < 10 THEN
        RETURN QUERY
        SELECT
            NULL::INTEGER,
            NULL::INTEGER,
            v_posts_in_range::BIGINT,
            0::DECIMAL,
            0::DECIMAL,
            FORMAT('Insufficient data for timing analysis (need 10+ posts, have %s)', v_posts_in_range)::TEXT
        LIMIT 1;
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        EXTRACT(HOUR FROM ip.timestamp)::INTEGER as hour_of_day,
        EXTRACT(DOW FROM ip.timestamp)::INTEGER as day_of_week,
        COUNT(*)::BIGINT as post_count,
        ROUND(AVG(pii.reach), 2) as avg_reach,
        ROUND(AVG(
            CASE
                WHEN pii.reach > 0 THEN (pii.total_interactions::DECIMAL / pii.reach::DECIMAL) * 100
                ELSE 0
            END
        ), 2) as avg_engagement_rate,
        FORMAT('Based on %s posts from %s', v_posts_in_range, v_actual_start_date)::TEXT
    FROM instagram_posts ip
    JOIN instagram_post_insights pii ON ip.id = pii.post_id
    WHERE ip.client_id = p_client_id
      AND ip.timestamp >= v_actual_start_date
      AND ip.is_deleted = FALSE
      AND pii.snapshot_date = (
          SELECT MAX(snapshot_date)
          FROM instagram_post_insights
          WHERE post_id = ip.id
      )
    GROUP BY hour_of_day, day_of_week
    HAVING COUNT(*) >= 2
    ORDER BY avg_engagement_rate DESC;
END;
$$ LANGUAGE plpgsql;

-- Adaptive version: Find top hashtags
CREATE OR REPLACE FUNCTION find_top_hashtags_adaptive(
    p_client_id VARCHAR(255),
    p_days INT DEFAULT 30,
    p_limit INT DEFAULT 20
)
RETURNS TABLE(
    hashtag TEXT,
    frequency BIGINT,
    avg_reach DECIMAL,
    avg_engagement_rate DECIMAL,
    status_message TEXT
) AS $$
DECLARE
    v_availability RECORD;
    v_actual_start_date DATE;
    v_posts_with_captions INTEGER;
BEGIN
    SELECT * INTO v_availability
    FROM get_client_data_availability(p_client_id);

    IF NOT v_availability.has_posts OR NOT v_availability.has_insights THEN
        RETURN QUERY
        SELECT
            NULL::TEXT,
            0::BIGINT,
            0::DECIMAL,
            0::DECIMAL,
            'No data available'::TEXT
        LIMIT 1;
        RETURN;
    END IF;

    v_actual_start_date := GREATEST(
        CURRENT_DATE - p_days,
        v_availability.earliest_post_date
    );

    SELECT COUNT(*) INTO v_posts_with_captions
    FROM instagram_posts
    WHERE client_id = p_client_id
      AND timestamp >= v_actual_start_date
      AND is_deleted = FALSE
      AND caption IS NOT NULL
      AND caption ~ '#\w+';

    IF v_posts_with_captions = 0 THEN
        RETURN QUERY
        SELECT
            NULL::TEXT,
            0::BIGINT,
            0::DECIMAL,
            0::DECIMAL,
            'No posts with hashtags found in date range'::TEXT
        LIMIT 1;
        RETURN;
    END IF;

    RETURN QUERY
    WITH hashtag_posts AS (
        SELECT
            ip.id,
            LOWER(UNNEST(REGEXP_MATCHES(ip.caption, '#(\w+)', 'g'))) as hashtag,
            pii.reach,
            CASE
                WHEN pii.reach > 0 THEN (pii.total_interactions::DECIMAL / pii.reach::DECIMAL) * 100
                ELSE 0
            END as engagement_rate
        FROM instagram_posts ip
        JOIN instagram_post_insights pii ON ip.id = pii.post_id
        WHERE ip.client_id = p_client_id
          AND ip.timestamp >= v_actual_start_date
          AND ip.is_deleted = FALSE
          AND ip.caption IS NOT NULL
          AND pii.snapshot_date = (
              SELECT MAX(snapshot_date)
              FROM instagram_post_insights
              WHERE instagram_post_insights.post_id = ip.id
          )
    )
    SELECT
        '#' || hp.hashtag as hashtag,
        COUNT(DISTINCT hp.id)::BIGINT as frequency,
        ROUND(AVG(hp.reach), 2) as avg_reach,
        ROUND(AVG(hp.engagement_rate), 2) as avg_engagement_rate,
        FORMAT('Found in %s posts with hashtags', v_posts_with_captions)::TEXT
    FROM hashtag_posts hp
    GROUP BY hp.hashtag
    HAVING COUNT(DISTINCT hp.id) >= 2
    ORDER BY avg_engagement_rate DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- GROWTH ANALYSIS - ADAPTIVE VERSIONS
-- ============================================================================

-- Adaptive version: Get follower growth
CREATE OR REPLACE FUNCTION get_follower_growth_adaptive(
    p_client_id VARCHAR(255),
    p_start_date DATE,
    p_end_date DATE
)
RETURNS TABLE(
    start_followers INTEGER,
    end_followers INTEGER,
    total_growth INTEGER,
    growth_percentage DECIMAL,
    avg_daily_growth DECIMAL,
    days_in_period INTEGER,
    actual_start_date DATE,
    actual_end_date DATE,
    date_range_adjusted BOOLEAN,
    data_quality TEXT
) AS $$
DECLARE
    v_availability RECORD;
    v_adj_range RECORD;
    v_start_followers INTEGER;
    v_end_followers INTEGER;
    v_days INTEGER;
BEGIN
    SELECT * INTO v_availability
    FROM get_client_data_availability(p_client_id);

    IF NOT v_availability.has_follower_history THEN
        SELECT followers_count INTO v_end_followers
        FROM instagram_account_profile
        WHERE client_id = p_client_id
        LIMIT 1;

        IF v_end_followers IS NOT NULL THEN
            RETURN QUERY
            SELECT
                NULL::INTEGER,
                v_end_followers,
                NULL::INTEGER,
                NULL::DECIMAL,
                NULL::DECIMAL,
                0,
                NULL::DATE,
                CURRENT_DATE,
                FALSE,
                'No historical follower data; showing current count from profile'::TEXT;
        ELSE
            RETURN QUERY
            SELECT
                NULL::INTEGER,
                NULL::INTEGER,
                NULL::INTEGER,
                NULL::DECIMAL,
                NULL::DECIMAL,
                0,
                NULL::DATE,
                NULL::DATE,
                FALSE,
                'No follower data available'::TEXT;
        END IF;
        RETURN;
    END IF;

    SELECT * INTO v_adj_range
    FROM adjust_date_range(p_client_id, p_start_date, p_end_date);

    IF v_adj_range.adjusted_start IS NULL THEN
        RETURN QUERY
        SELECT
            NULL::INTEGER,
            NULL::INTEGER,
            NULL::INTEGER,
            NULL::DECIMAL,
            NULL::DECIMAL,
            0,
            NULL::DATE,
            NULL::DATE,
            TRUE,
            v_adj_range.adjustment_reason::TEXT;
        RETURN;
    END IF;

    SELECT followers_count INTO v_start_followers
    FROM instagram_follower_history
    WHERE client_id = p_client_id
      AND snapshot_date <= v_adj_range.adjusted_start
    ORDER BY snapshot_date DESC
    LIMIT 1;

    SELECT followers_count INTO v_end_followers
    FROM instagram_follower_history
    WHERE client_id = p_client_id
      AND snapshot_date <= v_adj_range.adjusted_end
    ORDER BY snapshot_date DESC
    LIMIT 1;

    IF v_end_followers IS NULL THEN
        SELECT followers_count INTO v_end_followers
        FROM instagram_account_profile
        WHERE client_id = p_client_id
        LIMIT 1;
    END IF;

    v_days := v_adj_range.adjusted_end - v_adj_range.adjusted_start;

    RETURN QUERY
    SELECT
        v_start_followers,
        v_end_followers,
        COALESCE(v_end_followers - v_start_followers, 0) as total_growth,
        CASE
            WHEN v_start_followers > 0 AND v_end_followers IS NOT NULL THEN
                ROUND(((v_end_followers::DECIMAL - v_start_followers::DECIMAL) / v_start_followers::DECIMAL) * 100, 2)
            ELSE 0
        END as growth_percentage,
        CASE
            WHEN v_days > 0 AND v_start_followers IS NOT NULL AND v_end_followers IS NOT NULL THEN
                ROUND((v_end_followers::DECIMAL - v_start_followers::DECIMAL) / v_days, 2)
            ELSE 0
        END as avg_daily_growth,
        v_days,
        v_adj_range.adjusted_start,
        v_adj_range.adjusted_end,
        v_adj_range.was_adjusted,
        CASE
            WHEN v_adj_range.was_adjusted THEN v_adj_range.adjustment_reason
            WHEN v_start_followers IS NULL THEN 'Start date before first follower snapshot'
            ELSE 'Complete data available'
        END::TEXT;
END;
$$ LANGUAGE plpgsql;

-- Adaptive version: Get audience breakdown
CREATE OR REPLACE FUNCTION get_audience_breakdown_adaptive(p_client_id VARCHAR(255))
RETURNS TABLE(
    top_city TEXT,
    top_city_count INTEGER,
    top_country TEXT,
    top_country_percentage DECIMAL,
    top_age_gender TEXT,
    total_audience_data_points INTEGER,
    snapshot_date DATE,
    status_message TEXT
) AS $$
DECLARE
    v_city_data JSONB;
    v_country_data JSONB;
    v_gender_age_data JSONB;
    v_snapshot_date DATE;
BEGIN
    SELECT
        audience_city,
        audience_country,
        audience_gender_age,
        iad.snapshot_date
    INTO
        v_city_data,
        v_country_data,
        v_gender_age_data,
        v_snapshot_date
    FROM instagram_audience_demographics iad
    WHERE client_id = p_client_id
    ORDER BY iad.snapshot_date DESC
    LIMIT 1;

    IF v_city_data IS NULL AND v_country_data IS NULL AND v_gender_age_data IS NULL THEN
        RETURN QUERY
        SELECT
            NULL::TEXT,
            NULL::INTEGER,
            NULL::TEXT,
            NULL::DECIMAL,
            NULL::TEXT,
            0,
            NULL::DATE,
            'No audience demographic data available'::TEXT;
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        (SELECT key FROM jsonb_each(v_city_data) ORDER BY value::TEXT::INTEGER DESC LIMIT 1) as top_city,
        (SELECT value::TEXT::INTEGER FROM jsonb_each(v_city_data) ORDER BY value::TEXT::INTEGER DESC LIMIT 1) as top_city_count,
        (SELECT key FROM jsonb_each(v_country_data) ORDER BY value::TEXT::INTEGER DESC LIMIT 1) as top_country,
        ROUND(
            (SELECT value::TEXT::DECIMAL FROM jsonb_each(v_country_data) ORDER BY value::TEXT::INTEGER DESC LIMIT 1),
            2
        ) as top_country_percentage,
        (SELECT key FROM jsonb_each(v_gender_age_data) ORDER BY value::TEXT::INTEGER DESC LIMIT 1) as top_age_gender,
        (SELECT COUNT(*) FROM jsonb_object_keys(COALESCE(v_city_data, '{}'::jsonb)))::INTEGER as total_audience_data_points,
        v_snapshot_date,
        FORMAT('Latest demographics from %s', v_snapshot_date)::TEXT;
END;
$$ LANGUAGE plpgsql;

-- Adaptive version: Calculate retention rate
CREATE OR REPLACE FUNCTION calculate_retention_rate_adaptive(
    p_client_id VARCHAR(255),
    p_days INT DEFAULT 30
)
RETURNS TABLE(
    retention_rate DECIMAL,
    posts_above_threshold BIGINT,
    total_posts BIGINT,
    average_reach DECIMAL,
    threshold_reach DECIMAL,
    status_message TEXT
) AS $$
DECLARE
    v_availability RECORD;
    v_actual_start_date DATE;
    v_retention_rate DECIMAL;
    v_posts_with_reach BIGINT;
    v_total_posts BIGINT;
    v_avg_reach DECIMAL;
    v_threshold DECIMAL;
BEGIN
    SELECT * INTO v_availability
    FROM get_client_data_availability(p_client_id);

    IF NOT v_availability.has_posts OR NOT v_availability.has_insights THEN
        RETURN QUERY
        SELECT
            0::DECIMAL,
            0::BIGINT,
            0::BIGINT,
            0::DECIMAL,
            0::DECIMAL,
            'No data available for retention calculation'::TEXT;
        RETURN;
    END IF;

    v_actual_start_date := GREATEST(
        CURRENT_DATE - p_days,
        v_availability.earliest_post_date
    );

    SELECT COUNT(DISTINCT ip.id)
    INTO v_total_posts
    FROM instagram_posts ip
    WHERE ip.client_id = p_client_id
      AND ip.timestamp >= v_actual_start_date
      AND ip.is_deleted = FALSE;

    IF v_total_posts = 0 THEN
        RETURN QUERY
        SELECT
            0::DECIMAL,
            0::BIGINT,
            0::BIGINT,
            0::DECIMAL,
            0::DECIMAL,
            FORMAT('No posts in last %s days', p_days)::TEXT;
        RETURN;
    END IF;

    SELECT AVG(pii.reach)
    INTO v_avg_reach
    FROM instagram_post_insights pii
    JOIN instagram_posts ip ON pii.post_id = ip.id
    WHERE ip.client_id = p_client_id
      AND ip.timestamp >= v_actual_start_date;

    v_threshold := v_avg_reach * 0.7;

    SELECT COUNT(DISTINCT ip.id)
    INTO v_posts_with_reach
    FROM instagram_posts ip
    JOIN instagram_post_insights pii ON ip.id = pii.post_id
    WHERE ip.client_id = p_client_id
      AND ip.timestamp >= v_actual_start_date
      AND ip.is_deleted = FALSE
      AND pii.reach >= v_threshold;

    IF v_total_posts > 0 THEN
        v_retention_rate := ROUND((v_posts_with_reach::DECIMAL / v_total_posts::DECIMAL) * 100, 2);
    ELSE
        v_retention_rate := 0;
    END IF;

    RETURN QUERY
    SELECT
        v_retention_rate,
        v_posts_with_reach,
        v_total_posts,
        ROUND(v_avg_reach, 2),
        ROUND(v_threshold, 2),
        FORMAT('Calculated from %s posts (70%% threshold = %s reach)',
               v_total_posts, ROUND(v_threshold, 0))::TEXT;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- ROI & MONETIZATION - ADAPTIVE VERSIONS
-- ============================================================================

-- Adaptive version: Get ad performance summary
CREATE OR REPLACE FUNCTION get_ad_performance_summary_adaptive(
    p_client_id VARCHAR(255),
    p_start_date DATE,
    p_end_date DATE
)
RETURNS TABLE(
    total_spend_cents BIGINT,
    total_spend_dollars DECIMAL,
    total_impressions BIGINT,
    total_clicks BIGINT,
    total_conversions BIGINT,
    avg_ctr DECIMAL,
    avg_cpc_cents BIGINT,
    avg_cpm_cents BIGINT,
    roas DECIMAL,
    campaigns_analyzed INTEGER,
    status_message TEXT
) AS $$
DECLARE
    v_availability RECORD;
    v_adj_range RECORD;
    v_campaign_count INTEGER;
BEGIN
    SELECT * INTO v_availability
    FROM get_client_data_availability(p_client_id);

    IF NOT v_availability.has_ad_campaigns THEN
        RETURN QUERY
        SELECT
            0::BIGINT,
            0::DECIMAL,
            0::BIGINT,
            0::BIGINT,
            0::BIGINT,
            0::DECIMAL,
            0::BIGINT,
            0::BIGINT,
            0::DECIMAL,
            0,
            'No ad campaign data available'::TEXT;
        RETURN;
    END IF;

    SELECT * INTO v_adj_range
    FROM adjust_date_range(p_client_id, p_start_date, p_end_date);

    IF v_adj_range.adjusted_start IS NULL THEN
        RETURN QUERY
        SELECT
            0::BIGINT,
            0::DECIMAL,
            0::BIGINT,
            0::BIGINT,
            0::BIGINT,
            0::DECIMAL,
            0::BIGINT,
            0::BIGINT,
            0::DECIMAL,
            0,
            v_adj_range.adjustment_reason::TEXT;
        RETURN;
    END IF;

    SELECT COUNT(DISTINCT ac.id)
    INTO v_campaign_count
    FROM ad_campaigns ac
    JOIN ad_campaign_insights aci ON ac.id = aci.campaign_id
    WHERE ac.client_id = p_client_id
      AND aci.snapshot_date BETWEEN v_adj_range.adjusted_start AND v_adj_range.adjusted_end;

    IF v_campaign_count = 0 THEN
        RETURN QUERY
        SELECT
            0::BIGINT,
            0::DECIMAL,
            0::BIGINT,
            0::BIGINT,
            0::BIGINT,
            0::DECIMAL,
            0::BIGINT,
            0::BIGINT,
            0::DECIMAL,
            0,
            FORMAT('No campaign data in date range %s to %s',
                   v_adj_range.adjusted_start, v_adj_range.adjusted_end)::TEXT;
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        SUM(aci.spend)::BIGINT as total_spend_cents,
        ROUND(SUM(aci.spend)::DECIMAL / 100, 2) as total_spend_dollars,
        SUM(aci.impressions)::BIGINT as total_impressions,
        SUM(aci.clicks)::BIGINT as total_clicks,
        SUM(aci.conversions)::BIGINT as total_conversions,
        ROUND(AVG(aci.ctr), 4) as avg_ctr,
        AVG(aci.cpc)::BIGINT as avg_cpc_cents,
        AVG(aci.cpm)::BIGINT as avg_cpm_cents,
        CASE
            WHEN SUM(aci.spend) > 0 THEN
                ROUND((SUM(aci.conversions)::DECIMAL * 50) / (SUM(aci.spend)::DECIMAL / 100), 2)
            ELSE 0
        END as roas,
        v_campaign_count,
        CASE
            WHEN v_adj_range.was_adjusted THEN
                FORMAT('Analyzed %s campaigns. %s', v_campaign_count, v_adj_range.adjustment_reason)
            ELSE
                FORMAT('Analyzed %s campaigns from %s to %s',
                       v_campaign_count, v_adj_range.adjusted_start, v_adj_range.adjusted_end)
        END::TEXT
    FROM ad_campaign_insights aci
    JOIN ad_campaigns ac ON aci.campaign_id = ac.id
    WHERE ac.client_id = p_client_id
      AND aci.snapshot_date BETWEEN v_adj_range.adjusted_start AND v_adj_range.adjusted_end;
END;
$$ LANGUAGE plpgsql;

-- Adaptive version: Calculate cost per engagement
CREATE OR REPLACE FUNCTION calculate_cost_per_engagement_adaptive(
    p_client_id VARCHAR(255),
    p_campaign_id VARCHAR(255) DEFAULT NULL
)
RETURNS TABLE(
    cost_per_engagement_dollars DECIMAL,
    total_spend_dollars DECIMAL,
    total_engagements BIGINT,
    campaigns_analyzed INTEGER,
    status_message TEXT
) AS $$
DECLARE
    v_total_spend_cents BIGINT;
    v_total_engagements BIGINT;
    v_cost_per_eng DECIMAL;
    v_campaign_count INTEGER;
BEGIN
    IF p_campaign_id IS NOT NULL THEN
        SELECT
            SUM(aci.spend),
            SUM(COALESCE(aci.clicks, 0))
        INTO v_total_spend_cents, v_total_engagements
        FROM ad_campaign_insights aci
        WHERE aci.campaign_id = p_campaign_id;

        v_campaign_count := 1;
    ELSE
        SELECT
            SUM(aci.spend),
            SUM(COALESCE(aci.clicks, 0)),
            COUNT(DISTINCT aci.campaign_id)
        INTO v_total_spend_cents, v_total_engagements, v_campaign_count
        FROM ad_campaign_insights aci
        JOIN ad_campaigns ac ON aci.campaign_id = ac.id
        WHERE ac.client_id = p_client_id;
    END IF;

    IF v_total_spend_cents IS NULL OR v_total_engagements IS NULL THEN
        RETURN QUERY
        SELECT
            0::DECIMAL,
            0::DECIMAL,
            0::BIGINT,
            0,
            CASE
                WHEN p_campaign_id IS NOT NULL THEN 'Campaign not found or has no data'
                ELSE 'No campaign data available for this client'
            END::TEXT;
        RETURN;
    END IF;

    IF v_total_engagements > 0 THEN
        v_cost_per_eng := ROUND((v_total_spend_cents::DECIMAL / 100) / v_total_engagements, 2);
    ELSE
        v_cost_per_eng := 0;
    END IF;

    RETURN QUERY
    SELECT
        v_cost_per_eng,
        ROUND(v_total_spend_cents::DECIMAL / 100, 2),
        v_total_engagements,
        v_campaign_count,
        CASE
            WHEN v_total_engagements = 0 THEN 'No engagements recorded'
            WHEN p_campaign_id IS NOT NULL THEN FORMAT('Campaign-specific analysis')
            ELSE FORMAT('Analyzed %s campaigns', v_campaign_count)
        END::TEXT;
END;
$$ LANGUAGE plpgsql;

-- Adaptive version: Compare campaign efficiency
CREATE OR REPLACE FUNCTION compare_campaign_efficiency_adaptive(
    p_client_id VARCHAR(255),
    p_days INT DEFAULT 30
)
RETURNS TABLE(
    campaign_id VARCHAR(255),
    campaign_name VARCHAR(500),
    total_spend_dollars DECIMAL,
    total_conversions BIGINT,
    cost_per_conversion_dollars DECIMAL,
    roas DECIMAL,
    efficiency_score DECIMAL,
    status_message TEXT
) AS $$
DECLARE
    v_availability RECORD;
    v_actual_start_date DATE;
    v_campaign_count INTEGER;
BEGIN
    SELECT * INTO v_availability
    FROM get_client_data_availability(p_client_id);

    IF NOT v_availability.has_ad_campaigns THEN
        RETURN QUERY
        SELECT
            NULL::VARCHAR(255),
            NULL::VARCHAR(500),
            0::DECIMAL,
            0::BIGINT,
            0::DECIMAL,
            0::DECIMAL,
            0::DECIMAL,
            'No ad campaign data available'::TEXT
        LIMIT 1;
        RETURN;
    END IF;

    v_actual_start_date := GREATEST(
        CURRENT_DATE - p_days,
        v_availability.earliest_campaign_date
    );

    SELECT COUNT(DISTINCT ac.id)
    INTO v_campaign_count
    FROM ad_campaigns ac
    JOIN ad_campaign_insights aci ON ac.id = aci.campaign_id
    WHERE ac.client_id = p_client_id
      AND aci.snapshot_date >= v_actual_start_date
      AND ac.is_deleted = FALSE;

    IF v_campaign_count = 0 THEN
        RETURN QUERY
        SELECT
            NULL::VARCHAR(255),
            NULL::VARCHAR(500),
            0::DECIMAL,
            0::BIGINT,
            0::DECIMAL,
            0::DECIMAL,
            0::DECIMAL,
            FORMAT('No campaigns with data in last %s days', p_days)::TEXT
        LIMIT 1;
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        ac.id,
        ac.name,
        ROUND(SUM(aci.spend)::DECIMAL / 100, 2) as total_spend_dollars,
        SUM(aci.conversions)::BIGINT as total_conversions,
        CASE
            WHEN SUM(aci.conversions) > 0 THEN
                ROUND((SUM(aci.spend)::DECIMAL / 100) / SUM(aci.conversions), 2)
            ELSE 0
        END as cost_per_conversion_dollars,
        CASE
            WHEN SUM(aci.spend) > 0 THEN
                ROUND((SUM(aci.conversions)::DECIMAL * 50) / (SUM(aci.spend)::DECIMAL / 100), 2)
            ELSE 0
        END as roas,
        CASE
            WHEN SUM(aci.spend) > 0 THEN
                ROUND((SUM(aci.conversions)::DECIMAL / (SUM(aci.spend)::DECIMAL / 100)) * 100, 2)
            ELSE 0
        END as efficiency_score,
        FORMAT('Comparing %s campaigns from %s', v_campaign_count, v_actual_start_date)::TEXT
    FROM ad_campaigns ac
    JOIN ad_campaign_insights aci ON ac.id = aci.campaign_id
    WHERE ac.client_id = p_client_id
      AND aci.snapshot_date >= v_actual_start_date
      AND ac.is_deleted = FALSE
    GROUP BY ac.id, ac.name
    HAVING SUM(aci.spend) > 0
    ORDER BY efficiency_score DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- Add comment to track migration version
COMMENT ON FUNCTION get_client_data_availability IS 'Migration 002: Graceful data handling - core availability checker';
COMMENT ON FUNCTION adjust_date_range IS 'Migration 002: Graceful data handling - automatic date range adjustment';
