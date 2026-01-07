-- ============================================================================
-- ANALYTICS DATABASE SCHEMA
-- Version: 001
-- Description: Complete analytics schema for Instagram and Meta Ads data
-- ============================================================================

-- ============================================================================
-- CREDENTIALS STORAGE
-- ============================================================================

-- Meta OAuth credentials (encrypted tokens)
CREATE TABLE IF NOT EXISTS meta_credentials (
    id SERIAL PRIMARY KEY,
    client_id VARCHAR(255) NOT NULL UNIQUE,
    access_token TEXT NOT NULL, -- Encrypted with AES-256
    token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    meta_user_id VARCHAR(255),
    facebook_page_id VARCHAR(255),
    instagram_business_account_id VARCHAR(255),
    ad_account_id VARCHAR(255),
    ad_library_verified BOOLEAN DEFAULT FALSE,
    last_refreshed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- INSTAGRAM DATA TABLES
-- ============================================================================

-- Instagram account profile (current state snapshot)
CREATE TABLE IF NOT EXISTS instagram_account_profile (
    id SERIAL PRIMARY KEY,
    client_id VARCHAR(255) NOT NULL,
    instagram_business_account_id VARCHAR(255) NOT NULL,
    username VARCHAR(255),
    name VARCHAR(255),
    biography TEXT,
    followers_count INTEGER NOT NULL,
    follows_count INTEGER,
    media_count INTEGER,
    profile_picture_url TEXT,
    website VARCHAR(500),
    -- Tracking
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(client_id, instagram_business_account_id)
);

-- Historical follower tracking (daily snapshots)
CREATE TABLE IF NOT EXISTS instagram_follower_history (
    id SERIAL PRIMARY KEY,
    client_id VARCHAR(255) NOT NULL,
    instagram_business_account_id VARCHAR(255) NOT NULL,
    followers_count INTEGER NOT NULL,
    follows_count INTEGER,
    snapshot_date DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(client_id, instagram_business_account_id, snapshot_date)
);

-- Instagram posts (media)
CREATE TABLE IF NOT EXISTS instagram_posts (
    id VARCHAR(255) PRIMARY KEY, -- Instagram media ID
    client_id VARCHAR(255) NOT NULL,
    instagram_business_account_id VARCHAR(255) NOT NULL,
    caption TEXT,
    media_type VARCHAR(50) NOT NULL, -- IMAGE, VIDEO, CAROUSEL_ALBUM
    media_url TEXT,
    permalink TEXT,
    thumbnail_url TEXT,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL, -- Post publish time
    username VARCHAR(255),
    like_count INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    -- Sync tracking
    last_insights_update TIMESTAMP WITH TIME ZONE,
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Instagram post insights (performance metrics)
CREATE TABLE IF NOT EXISTS instagram_post_insights (
    id SERIAL PRIMARY KEY,
    post_id VARCHAR(255) NOT NULL REFERENCES instagram_posts(id) ON DELETE CASCADE,
    client_id VARCHAR(255) NOT NULL,
    -- Metrics (all as BIGINT - API returns as integers)
    views BIGINT DEFAULT 0,
    reach BIGINT DEFAULT 0,
    saved BIGINT DEFAULT 0,
    total_interactions BIGINT DEFAULT 0,
    likes BIGINT DEFAULT 0,
    comments BIGINT DEFAULT 0,
    shares BIGINT DEFAULT 0,
    -- Tracking
    snapshot_date DATE NOT NULL, -- Date when these insights were captured
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(post_id, snapshot_date)
);

-- Instagram account insights (daily profile metrics)
CREATE TABLE IF NOT EXISTS instagram_account_insights (
    id SERIAL PRIMARY KEY,
    client_id VARCHAR(255) NOT NULL,
    instagram_business_account_id VARCHAR(255) NOT NULL,
    -- Daily metrics (these are CHANGES, not totals)
    reach BIGINT DEFAULT 0,
    profile_views BIGINT DEFAULT 0,
    follower_count INTEGER DEFAULT 0, -- Daily change in followers
    -- Tracking
    snapshot_date DATE NOT NULL,
    period VARCHAR(20) NOT NULL, -- 'day', 'week', 'days_28'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(client_id, instagram_business_account_id, snapshot_date, period)
);

-- Instagram audience demographics (follower insights)
CREATE TABLE IF NOT EXISTS instagram_audience_demographics (
    id SERIAL PRIMARY KEY,
    client_id VARCHAR(255) NOT NULL,
    instagram_business_account_id VARCHAR(255) NOT NULL,
    -- Demographics data (JSONB for flexibility)
    audience_city JSONB, -- {"Los Angeles": 1250, "New York": 890, ...}
    audience_country JSONB, -- {"US": 8500, "CA": 1200, ...}
    audience_gender_age JSONB, -- {"M.25-34": 3200, "F.18-24": 2800, ...}
    audience_locale JSONB, -- {"en_US": 7500, "es_US": 1200, ...}
    -- Tracking
    snapshot_date DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(client_id, instagram_business_account_id, snapshot_date)
);

-- ============================================================================
-- META ADS DATA TABLES
-- ============================================================================

-- Ad campaigns
CREATE TABLE IF NOT EXISTS ad_campaigns (
    id VARCHAR(255) PRIMARY KEY, -- Meta campaign ID
    client_id VARCHAR(255) NOT NULL,
    ad_account_id VARCHAR(255) NOT NULL,
    name VARCHAR(500),
    status VARCHAR(50) NOT NULL, -- ACTIVE, PAUSED, ARCHIVED
    objective VARCHAR(100),
    daily_budget BIGINT, -- In cents, nullable
    lifetime_budget BIGINT, -- In cents, nullable
    start_time TIMESTAMP WITH TIME ZONE,
    stop_time TIMESTAMP WITH TIME ZONE,
    -- Tracking
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Campaign insights (daily performance snapshots)
CREATE TABLE IF NOT EXISTS ad_campaign_insights (
    id SERIAL PRIMARY KEY,
    campaign_id VARCHAR(255) NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
    client_id VARCHAR(255) NOT NULL,
    -- Metrics (stored in cents for monetary values, integers for counts)
    spend BIGINT DEFAULT 0, -- In cents
    impressions BIGINT DEFAULT 0,
    clicks BIGINT DEFAULT 0,
    ctr DECIMAL(10, 4), -- Click-through rate as decimal (e.g., 0.0325 = 3.25%)
    cpc BIGINT, -- Cost per click in cents
    cpm BIGINT, -- Cost per 1000 impressions in cents
    reach BIGINT DEFAULT 0,
    frequency DECIMAL(10, 2),
    actions JSONB, -- Array of action objects: [{"action_type": "link_click", "value": "42"}, ...]
    conversions BIGINT DEFAULT 0,
    cost_per_action_type JSONB, -- {"link_click": "125", "purchase": "2500", ...} (in cents)
    -- Tracking
    snapshot_date DATE NOT NULL,
    date_preset VARCHAR(50), -- 'today', 'last_7d', 'last_30d', 'lifetime'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(campaign_id, snapshot_date, date_preset)
);

-- Ad sets
CREATE TABLE IF NOT EXISTS ad_sets (
    id VARCHAR(255) PRIMARY KEY, -- Meta ad set ID
    campaign_id VARCHAR(255) NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
    client_id VARCHAR(255) NOT NULL,
    name VARCHAR(500),
    status VARCHAR(50) NOT NULL,
    daily_budget BIGINT,
    lifetime_budget BIGINT,
    start_time TIMESTAMP WITH TIME ZONE,
    end_time TIMESTAMP WITH TIME ZONE,
    targeting JSONB, -- Full targeting configuration
    optimization_goal VARCHAR(100),
    billing_event VARCHAR(100),
    -- Tracking
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Individual ads
CREATE TABLE IF NOT EXISTS ads (
    id VARCHAR(255) PRIMARY KEY, -- Meta ad ID
    ad_set_id VARCHAR(255) NOT NULL REFERENCES ad_sets(id) ON DELETE CASCADE,
    client_id VARCHAR(255) NOT NULL,
    name VARCHAR(500),
    status VARCHAR(50) NOT NULL,
    creative JSONB, -- Full creative object
    tracking_specs JSONB,
    conversion_specs JSONB,
    -- Tracking
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Ad insights (performance for individual ads)
CREATE TABLE IF NOT EXISTS ad_insights (
    id SERIAL PRIMARY KEY,
    ad_id VARCHAR(255) NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
    client_id VARCHAR(255) NOT NULL,
    -- Same metrics as campaign insights
    spend BIGINT DEFAULT 0,
    impressions BIGINT DEFAULT 0,
    clicks BIGINT DEFAULT 0,
    ctr DECIMAL(10, 4),
    cpc BIGINT,
    cpm BIGINT,
    reach BIGINT DEFAULT 0,
    frequency DECIMAL(10, 2),
    actions JSONB,
    conversions BIGINT DEFAULT 0,
    -- Tracking
    snapshot_date DATE NOT NULL,
    date_preset VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(ad_id, snapshot_date, date_preset)
);

-- ============================================================================
-- SYNC TRACKING & JOB QUEUE
-- ============================================================================

-- Tracks sync status for each client
CREATE TABLE IF NOT EXISTS sync_status (
    id SERIAL PRIMARY KEY,
    client_id VARCHAR(255) NOT NULL,
    instagram_business_account_id VARCHAR(255),
    ad_account_id VARCHAR(255),
    -- Backfill tracking
    backfill_completed BOOLEAN DEFAULT FALSE,
    backfill_started_at TIMESTAMP WITH TIME ZONE,
    backfill_completed_at TIMESTAMP WITH TIME ZONE,
    backfill_error TEXT,
    -- Regular sync tracking
    last_instagram_sync TIMESTAMP WITH TIME ZONE,
    last_ads_sync TIMESTAMP WITH TIME ZONE,
    last_sync_error TEXT,
    -- Tracking
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(client_id)
);

-- Job queue for sync tasks
CREATE TABLE IF NOT EXISTS sync_jobs (
    id SERIAL PRIMARY KEY,
    client_id VARCHAR(255) NOT NULL,
    job_type VARCHAR(100) NOT NULL, -- 'backfill', 'daily_sync', 'post_insights_update'
    job_payload JSONB, -- Flexible payload for job-specific data
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
    priority INTEGER DEFAULT 0, -- Higher = more urgent
    scheduled_for TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Instagram posts indexes
CREATE INDEX IF NOT EXISTS idx_instagram_posts_client ON instagram_posts(client_id);
CREATE INDEX IF NOT EXISTS idx_instagram_posts_account ON instagram_posts(instagram_business_account_id);
CREATE INDEX IF NOT EXISTS idx_instagram_posts_timestamp ON instagram_posts(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_instagram_posts_type ON instagram_posts(media_type);
CREATE INDEX IF NOT EXISTS idx_instagram_posts_deleted ON instagram_posts(is_deleted);

-- Instagram post insights indexes
CREATE INDEX IF NOT EXISTS idx_post_insights_post_id ON instagram_post_insights(post_id);
CREATE INDEX IF NOT EXISTS idx_post_insights_snapshot ON instagram_post_insights(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_post_insights_client ON instagram_post_insights(client_id);

-- Instagram account insights indexes
CREATE INDEX IF NOT EXISTS idx_account_insights_account ON instagram_account_insights(instagram_business_account_id);
CREATE INDEX IF NOT EXISTS idx_account_insights_date ON instagram_account_insights(snapshot_date DESC);

-- Instagram follower history indexes
CREATE INDEX IF NOT EXISTS idx_follower_history_client ON instagram_follower_history(client_id);
CREATE INDEX IF NOT EXISTS idx_follower_history_date ON instagram_follower_history(snapshot_date DESC);

-- Ad campaigns indexes
CREATE INDEX IF NOT EXISTS idx_campaigns_client ON ad_campaigns(client_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_account ON ad_campaigns(ad_account_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON ad_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_deleted ON ad_campaigns(is_deleted);

-- Campaign insights indexes
CREATE INDEX IF NOT EXISTS idx_campaign_insights_campaign ON ad_campaign_insights(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_insights_date ON ad_campaign_insights(snapshot_date DESC);

-- Sync jobs indexes
CREATE INDEX IF NOT EXISTS idx_sync_jobs_status ON sync_jobs(status);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_scheduled ON sync_jobs(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_client ON sync_jobs(client_id);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_type ON sync_jobs(job_type);

-- ============================================================================
-- AUTO-UPDATE TRIGGERS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables
CREATE TRIGGER update_instagram_account_profile_updated_at BEFORE UPDATE ON instagram_account_profile
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_instagram_posts_updated_at BEFORE UPDATE ON instagram_posts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_instagram_post_insights_updated_at BEFORE UPDATE ON instagram_post_insights
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_instagram_audience_demographics_updated_at BEFORE UPDATE ON instagram_audience_demographics
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ad_campaigns_updated_at BEFORE UPDATE ON ad_campaigns
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ad_campaign_insights_updated_at BEFORE UPDATE ON ad_campaign_insights
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ad_sets_updated_at BEFORE UPDATE ON ad_sets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ads_updated_at BEFORE UPDATE ON ads
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ad_insights_updated_at BEFORE UPDATE ON ad_insights
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sync_status_updated_at BEFORE UPDATE ON sync_status
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sync_jobs_updated_at BEFORE UPDATE ON sync_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- HELPER FUNCTIONS - PERFORMANCE TRACKING
-- ============================================================================

-- Get total reach for a date range
CREATE OR REPLACE FUNCTION get_total_reach(
    p_client_id VARCHAR(255),
    p_start_date DATE,
    p_end_date DATE
)
RETURNS BIGINT AS $$
DECLARE
    total_reach BIGINT;
BEGIN
    SELECT COALESCE(SUM(DISTINCT pii.reach), 0)
    INTO total_reach
    FROM instagram_posts ip
    JOIN instagram_post_insights pii ON ip.id = pii.post_id
    WHERE ip.client_id = p_client_id
      AND ip.timestamp::DATE BETWEEN p_start_date AND p_end_date
      AND ip.is_deleted = FALSE
      AND pii.snapshot_date = (
          SELECT MAX(snapshot_date)
          FROM instagram_post_insights
          WHERE post_id = ip.id
      );

    RETURN total_reach;
END;
$$ LANGUAGE plpgsql;

-- Get top posts by any metric
CREATE OR REPLACE FUNCTION get_top_posts(
    p_client_id VARCHAR(255),
    p_metric TEXT, -- 'views', 'reach', 'saved', 'total_interactions', 'engagement_rate'
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
    engagement_rate DECIMAL
) AS $$
BEGIN
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

-- Get engagement rate for a specific post
CREATE OR REPLACE FUNCTION get_engagement_rate(p_post_id VARCHAR(255))
RETURNS DECIMAL AS $$
DECLARE
    eng_rate DECIMAL;
BEGIN
    SELECT
        CASE
            WHEN pii.reach > 0 THEN
                ROUND((pii.total_interactions::DECIMAL / pii.reach::DECIMAL) * 100, 2)
            ELSE 0
        END
    INTO eng_rate
    FROM instagram_post_insights pii
    WHERE pii.post_id = p_post_id
    ORDER BY pii.snapshot_date DESC
    LIMIT 1;

    RETURN COALESCE(eng_rate, 0);
END;
$$ LANGUAGE plpgsql;

-- Compare two time periods for any metric
CREATE OR REPLACE FUNCTION compare_periods(
    p_client_id VARCHAR(255),
    p_metric TEXT, -- 'reach', 'engagement', 'followers'
    p_period1_start DATE,
    p_period1_end DATE,
    p_period2_start DATE,
    p_period2_end DATE
)
RETURNS TABLE(
    period1_value BIGINT,
    period2_value BIGINT,
    change_absolute BIGINT,
    change_percentage DECIMAL
) AS $$
DECLARE
    v_period1 BIGINT;
    v_period2 BIGINT;
BEGIN
    -- Calculate period 1
    IF p_metric = 'reach' THEN
        SELECT COALESCE(SUM(pii.reach), 0)
        INTO v_period1
        FROM instagram_posts ip
        JOIN instagram_post_insights pii ON ip.id = pii.post_id
        WHERE ip.client_id = p_client_id
          AND ip.timestamp::DATE BETWEEN p_period1_start AND p_period1_end
          AND ip.is_deleted = FALSE;
    ELSIF p_metric = 'engagement' THEN
        SELECT COALESCE(SUM(pii.total_interactions), 0)
        INTO v_period1
        FROM instagram_posts ip
        JOIN instagram_post_insights pii ON ip.id = pii.post_id
        WHERE ip.client_id = p_client_id
          AND ip.timestamp::DATE BETWEEN p_period1_start AND p_period1_end
          AND ip.is_deleted = FALSE;
    ELSIF p_metric = 'followers' THEN
        SELECT followers_count
        INTO v_period1
        FROM instagram_follower_history
        WHERE client_id = p_client_id
          AND snapshot_date = p_period1_end
        LIMIT 1;
    END IF;

    -- Calculate period 2
    IF p_metric = 'reach' THEN
        SELECT COALESCE(SUM(pii.reach), 0)
        INTO v_period2
        FROM instagram_posts ip
        JOIN instagram_post_insights pii ON ip.id = pii.post_id
        WHERE ip.client_id = p_client_id
          AND ip.timestamp::DATE BETWEEN p_period2_start AND p_period2_end
          AND ip.is_deleted = FALSE;
    ELSIF p_metric = 'engagement' THEN
        SELECT COALESCE(SUM(pii.total_interactions), 0)
        INTO v_period2
        FROM instagram_posts ip
        JOIN instagram_post_insights pii ON ip.id = pii.post_id
        WHERE ip.client_id = p_client_id
          AND ip.timestamp::DATE BETWEEN p_period2_start AND p_period2_end
          AND ip.is_deleted = FALSE;
    ELSIF p_metric = 'followers' THEN
        SELECT followers_count
        INTO v_period2
        FROM instagram_follower_history
        WHERE client_id = p_client_id
          AND snapshot_date = p_period2_end
        LIMIT 1;
    END IF;

    RETURN QUERY
    SELECT
        v_period1,
        v_period2,
        v_period2 - v_period1 as change_absolute,
        CASE
            WHEN v_period1 > 0 THEN
                ROUND(((v_period2::DECIMAL - v_period1::DECIMAL) / v_period1::DECIMAL) * 100, 2)
            ELSE 0
        END as change_percentage;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- HELPER FUNCTIONS - CONTENT STRATEGY
-- ============================================================================

-- Analyze performance by content type
CREATE OR REPLACE FUNCTION analyze_content_types(
    p_client_id VARCHAR(255),
    p_days INT DEFAULT 30
)
RETURNS TABLE(
    media_type VARCHAR(50),
    post_count BIGINT,
    avg_reach DECIMAL,
    avg_engagement DECIMAL,
    avg_engagement_rate DECIMAL,
    total_saves BIGINT
) AS $$
BEGIN
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
        SUM(pii.saved)::BIGINT as total_saves
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
    GROUP BY ip.media_type
    ORDER BY avg_engagement_rate DESC;
END;
$$ LANGUAGE plpgsql;

-- Find best posting times
CREATE OR REPLACE FUNCTION get_best_posting_times(
    p_client_id VARCHAR(255),
    p_days INT DEFAULT 90
)
RETURNS TABLE(
    hour_of_day INTEGER,
    day_of_week INTEGER, -- 0=Sunday, 6=Saturday
    post_count BIGINT,
    avg_reach DECIMAL,
    avg_engagement_rate DECIMAL
) AS $$
BEGIN
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
        ), 2) as avg_engagement_rate
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
    GROUP BY hour_of_day, day_of_week
    HAVING COUNT(*) >= 2 -- Only show times with at least 2 posts
    ORDER BY avg_engagement_rate DESC;
END;
$$ LANGUAGE plpgsql;

-- Extract and analyze hashtags from captions
CREATE OR REPLACE FUNCTION find_top_hashtags(
    p_client_id VARCHAR(255),
    p_days INT DEFAULT 30,
    p_limit INT DEFAULT 20
)
RETURNS TABLE(
    hashtag TEXT,
    frequency BIGINT,
    avg_reach DECIMAL,
    avg_engagement_rate DECIMAL
) AS $$
BEGIN
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
          AND ip.timestamp >= CURRENT_DATE - p_days
          AND ip.is_deleted = FALSE
          AND ip.caption IS NOT NULL
          AND pii.snapshot_date = (
              SELECT MAX(snapshot_date)
              FROM instagram_post_insights
              WHERE post_id = ip.id
          )
    )
    SELECT
        '#' || hp.hashtag as hashtag,
        COUNT(DISTINCT hp.id)::BIGINT as frequency,
        ROUND(AVG(hp.reach), 2) as avg_reach,
        ROUND(AVG(hp.engagement_rate), 2) as avg_engagement_rate
    FROM hashtag_posts hp
    GROUP BY hp.hashtag
    HAVING COUNT(DISTINCT hp.id) >= 2
    ORDER BY avg_engagement_rate DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- HELPER FUNCTIONS - GROWTH ANALYSIS
-- ============================================================================

-- Get follower growth metrics
CREATE OR REPLACE FUNCTION get_follower_growth(
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
    days_in_period INTEGER
) AS $$
DECLARE
    v_start_followers INTEGER;
    v_end_followers INTEGER;
    v_days INTEGER;
BEGIN
    -- Get start followers
    SELECT followers_count INTO v_start_followers
    FROM instagram_follower_history
    WHERE client_id = p_client_id
      AND snapshot_date <= p_start_date
    ORDER BY snapshot_date DESC
    LIMIT 1;

    -- Get end followers
    SELECT followers_count INTO v_end_followers
    FROM instagram_follower_history
    WHERE client_id = p_client_id
      AND snapshot_date <= p_end_date
    ORDER BY snapshot_date DESC
    LIMIT 1;

    -- If no historical data, try current profile
    IF v_end_followers IS NULL THEN
        SELECT followers_count INTO v_end_followers
        FROM instagram_account_profile
        WHERE client_id = p_client_id
        LIMIT 1;
    END IF;

    v_days := p_end_date - p_start_date;

    RETURN QUERY
    SELECT
        v_start_followers,
        v_end_followers,
        v_end_followers - v_start_followers as total_growth,
        CASE
            WHEN v_start_followers > 0 THEN
                ROUND(((v_end_followers::DECIMAL - v_start_followers::DECIMAL) / v_start_followers::DECIMAL) * 100, 2)
            ELSE 0
        END as growth_percentage,
        CASE
            WHEN v_days > 0 THEN
                ROUND((v_end_followers::DECIMAL - v_start_followers::DECIMAL) / v_days, 2)
            ELSE 0
        END as avg_daily_growth,
        v_days;
END;
$$ LANGUAGE plpgsql;

-- Get audience breakdown summary
CREATE OR REPLACE FUNCTION get_audience_breakdown(p_client_id VARCHAR(255))
RETURNS TABLE(
    top_city TEXT,
    top_city_count INTEGER,
    top_country TEXT,
    top_country_percentage DECIMAL,
    top_age_gender TEXT,
    total_audience_data_points INTEGER
) AS $$
DECLARE
    v_city_data JSONB;
    v_country_data JSONB;
    v_gender_age_data JSONB;
BEGIN
    -- Get latest demographics
    SELECT
        audience_city,
        audience_country,
        audience_gender_age
    INTO
        v_city_data,
        v_country_data,
        v_gender_age_data
    FROM instagram_audience_demographics
    WHERE client_id = p_client_id
    ORDER BY snapshot_date DESC
    LIMIT 1;

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
        (SELECT COUNT(*) FROM jsonb_object_keys(v_city_data))::INTEGER as total_audience_data_points;
END;
$$ LANGUAGE plpgsql;

-- Calculate retention rate (posts maintaining reach above threshold)
CREATE OR REPLACE FUNCTION calculate_retention_rate(
    p_client_id VARCHAR(255),
    p_days INT DEFAULT 30
)
RETURNS DECIMAL AS $$
DECLARE
    retention_rate DECIMAL;
    posts_with_reach BIGINT;
    total_posts BIGINT;
BEGIN
    SELECT COUNT(DISTINCT ip.id)
    INTO total_posts
    FROM instagram_posts ip
    WHERE ip.client_id = p_client_id
      AND ip.timestamp >= CURRENT_DATE - p_days
      AND ip.is_deleted = FALSE;

    SELECT COUNT(DISTINCT ip.id)
    INTO posts_with_reach
    FROM instagram_posts ip
    JOIN instagram_post_insights pii ON ip.id = pii.post_id
    WHERE ip.client_id = p_client_id
      AND ip.timestamp >= CURRENT_DATE - p_days
      AND ip.is_deleted = FALSE
      AND pii.reach >= (
          SELECT AVG(reach) * 0.7 -- Posts with reach >= 70% of average
          FROM instagram_post_insights pii2
          JOIN instagram_posts ip2 ON pii2.post_id = ip2.id
          WHERE ip2.client_id = p_client_id
      );

    IF total_posts > 0 THEN
        retention_rate := ROUND((posts_with_reach::DECIMAL / total_posts::DECIMAL) * 100, 2);
    ELSE
        retention_rate := 0;
    END IF;

    RETURN retention_rate;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- HELPER FUNCTIONS - ROI & MONETIZATION
-- ============================================================================

-- Get ad performance summary
CREATE OR REPLACE FUNCTION get_ad_performance_summary(
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
    roas DECIMAL
) AS $$
BEGIN
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
        -- ROAS calculation (placeholder - requires conversion value tracking)
        CASE
            WHEN SUM(aci.spend) > 0 THEN
                ROUND((SUM(aci.conversions)::DECIMAL * 50) / (SUM(aci.spend)::DECIMAL / 100), 2)
            ELSE 0
        END as roas
    FROM ad_campaign_insights aci
    JOIN ad_campaigns ac ON aci.campaign_id = ac.id
    WHERE ac.client_id = p_client_id
      AND aci.snapshot_date BETWEEN p_start_date AND p_end_date;
END;
$$ LANGUAGE plpgsql;

-- Calculate cost per engagement
CREATE OR REPLACE FUNCTION calculate_cost_per_engagement(
    p_client_id VARCHAR(255),
    p_campaign_id VARCHAR(255) DEFAULT NULL
)
RETURNS DECIMAL AS $$
DECLARE
    total_spend_cents BIGINT;
    total_engagements BIGINT;
    cost_per_eng DECIMAL;
BEGIN
    IF p_campaign_id IS NOT NULL THEN
        -- Specific campaign
        SELECT
            SUM(aci.spend),
            SUM(COALESCE(aci.clicks, 0))
        INTO total_spend_cents, total_engagements
        FROM ad_campaign_insights aci
        WHERE aci.campaign_id = p_campaign_id;
    ELSE
        -- All campaigns for client
        SELECT
            SUM(aci.spend),
            SUM(COALESCE(aci.clicks, 0))
        INTO total_spend_cents, total_engagements
        FROM ad_campaign_insights aci
        JOIN ad_campaigns ac ON aci.campaign_id = ac.id
        WHERE ac.client_id = p_client_id;
    END IF;

    IF total_engagements > 0 THEN
        cost_per_eng := ROUND((total_spend_cents::DECIMAL / 100) / total_engagements, 2);
    ELSE
        cost_per_eng := 0;
    END IF;

    RETURN cost_per_eng;
END;
$$ LANGUAGE plpgsql;

-- Compare campaign efficiency
CREATE OR REPLACE FUNCTION compare_campaign_efficiency(
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
    efficiency_score DECIMAL
) AS $$
BEGIN
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
        END as efficiency_score
    FROM ad_campaigns ac
    JOIN ad_campaign_insights aci ON ac.id = aci.campaign_id
    WHERE ac.client_id = p_client_id
      AND aci.snapshot_date >= CURRENT_DATE - p_days
      AND ac.is_deleted = FALSE
    GROUP BY ac.id, ac.name
    HAVING SUM(aci.spend) > 0
    ORDER BY efficiency_score DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
