const db = require('../lib/db');
const logger = require('../lib/logger');
const instagram = require('../lib/instagram');
const metaAds = require('../lib/metaAds');
const { getAccountIds } = require('../lib/credentials');

/**
 * Execute backfill job - fetch last 30 days of data
 */
async function execute(job) {
  const { client_id } = job;
  const startTime = Date.now();

  logger.sync(client_id, 'Starting backfill job', {
    jobId: job.id,
  });

  try {
    // Mark backfill as started
    logger.sync(client_id, 'Marking backfill as started in sync_status');
    await updateSyncStatus(client_id, {
      backfill_started_at: new Date().toISOString(),
      last_instagram_sync: new Date().toISOString(),
    });
    logger.sync(client_id, 'Sync status updated');

    // Get account IDs
    logger.sync(client_id, 'Fetching account IDs from credentials');
    const accountIds = await getAccountIds(client_id);
    logger.sync(client_id, 'Account IDs fetched', accountIds);

    const stats = {
      instagram_profile: 0,
      instagram_posts: 0,
      instagram_carousel_children: 0,
      instagram_post_insights: 0,
      instagram_account_insights: 0,
      instagram_demographics: 0,
      ad_campaigns: 0,
      ad_campaign_insights: 0,
    };

    // 1. Fetch and store Instagram profile
    if (accountIds.instagram_business_account_id) {
      await backfillInstagramProfile(client_id);
      stats.instagram_profile = 1;

      // 2. Fetch and store Instagram posts (last 30 days)
      const postCount = await backfillInstagramPosts(client_id, accountIds.instagram_business_account_id);
      stats.instagram_posts = postCount;

      // 3. Fetch and store carousel children
      const carouselChildrenCount = await backfillCarouselChildren(client_id);
      stats.instagram_carousel_children = carouselChildrenCount;

      // 4. Fetch and store post insights
      const insightsCount = await backfillPostInsights(client_id);
      stats.instagram_post_insights = insightsCount;

      // 5. Fetch and store account insights (last 30 days)
      const accountInsightsCount = await backfillAccountInsights(client_id);
      stats.instagram_account_insights = accountInsightsCount;

      // 6. Fetch and store audience demographics
      await backfillAudienceDemographics(client_id);
      stats.instagram_demographics = 1;
    }

    // 7. Fetch and store ad campaigns (if ad account exists)
    if (accountIds.ad_account_id) {
      const campaignCount = await backfillAdCampaigns(client_id);
      stats.ad_campaigns = campaignCount;

      // 8. Fetch and store campaign insights
      const campaignInsightsCount = await backfillCampaignInsights(client_id);
      stats.ad_campaign_insights = campaignInsightsCount;
    }

    // Mark backfill as completed
    await updateSyncStatus(client_id, {
      backfill_completed: true,
      backfill_completed_at: new Date().toISOString(),
      last_instagram_sync: new Date().toISOString(),
      last_ads_sync: new Date().toISOString(),
    });

    const duration = Date.now() - startTime;
    logger.sync(client_id, 'Backfill completed successfully', {
      jobId: job.id,
      durationMs: duration,
      durationMinutes: Math.round(duration / 1000 / 60),
      stats,
    });

    return { success: true, stats, duration };
  } catch (error) {
    logger.error('Backfill job failed', {
      clientId: client_id,
      jobId: job.id,
      error: error.message,
      stack: error.stack,
    });

    // Update sync status with error
    await updateSyncStatus(client_id, {
      backfill_error: error.message,
      last_sync_error: error.message,
    });

    throw error;
  }
}

/**
 * Backfill Instagram profile data
 */
async function backfillInstagramProfile(clientId) {
  logger.sync(clientId, 'Fetching Instagram profile');

  const profile = await instagram.getProfile(clientId);

  await db.query(
    `
    INSERT INTO instagram_account_profile (
      client_id, instagram_business_account_id, username, name, biography,
      followers_count, follows_count, media_count,
      profile_picture_url, website
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (client_id, instagram_business_account_id)
    DO UPDATE SET
      username = EXCLUDED.username,
      name = EXCLUDED.name,
      biography = EXCLUDED.biography,
      followers_count = EXCLUDED.followers_count,
      follows_count = EXCLUDED.follows_count,
      media_count = EXCLUDED.media_count,
      profile_picture_url = EXCLUDED.profile_picture_url,
      website = EXCLUDED.website,
      updated_at = NOW()
  `,
    [
      clientId,
      profile.id,
      profile.username,
      profile.name || null,
      profile.biography || null,
      profile.followers_count || 0,
      profile.follows_count || 0,
      profile.media_count || 0,
      profile.profile_picture_url || null,
      profile.website || null,
    ]
  );

  // Also create initial follower history entry
  await db.query(
    `
    INSERT INTO instagram_follower_history (
      client_id, instagram_business_account_id, followers_count, snapshot_date
    )
    VALUES ($1, $2, $3, CURRENT_DATE)
    ON CONFLICT (client_id, instagram_business_account_id, snapshot_date) DO NOTHING
  `,
    [clientId, profile.id, profile.followers_count || 0]
  );

  logger.sync(clientId, 'Instagram profile stored', {
    username: profile.username,
    followers: profile.followers_count,
  });
}

/**
 * Backfill Instagram posts (ALL posts with pagination)
 */
async function backfillInstagramPosts(clientId, instagramBusinessAccountId) {
  logger.sync(clientId, 'Fetching ALL Instagram posts (paginated)');

  const axios = require('axios');
  const { instagramRateLimiter } = require('../lib/rateLimiter');
  const { getClientCredentials } = require('../lib/credentials');

  const credentials = await getClientCredentials(clientId);

  // Get first page (no 'since' parameter = get all posts)
  let mediaResponse = await instagram.getMedia(clientId, 25);
  let allPosts = mediaResponse.data || [];
  let pageCount = 1;
  let nextUrl = mediaResponse.paging?.next;

  // Follow pagination to get ALL posts
  while (nextUrl && pageCount < 50) {
    // Max 50 pages (~1250 posts)
    logger.sync(clientId, 'Fetching next page of posts', {
      pageNumber: pageCount + 1,
      currentTotal: allPosts.length,
    });

    // Use axios directly for pagination URLs
    const response = await instagramRateLimiter.execute(async () => {
      return await axios.get(nextUrl, {
        params: { access_token: credentials.access_token },
        timeout: 30000,
      });
    });

    if (response.data.data) {
      allPosts.push(...response.data.data);
    }

    nextUrl = response.data.paging?.next || null;
    pageCount++;
  }

  logger.sync(clientId, 'Finished fetching posts', {
    totalPages: pageCount,
    totalPosts: allPosts.length,
  });

  // Insert all posts
  let insertCount = 0;

  for (const post of allPosts) {

    await db.query(
      `
      INSERT INTO instagram_posts (
        id, client_id, instagram_business_account_id, media_type, caption, media_url,
        permalink, thumbnail_url, timestamp, username,
        like_count, comments_count
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (id) DO UPDATE SET
        like_count = EXCLUDED.like_count,
        comments_count = EXCLUDED.comments_count,
        updated_at = NOW()
    `,
      [
        post.id,
        clientId,
        instagramBusinessAccountId,
        post.media_type,
        post.caption || null,
        post.media_url || null,
        post.permalink || null,
        post.thumbnail_url || null,
        post.timestamp,
        post.username,
        post.like_count || 0,
        post.comments_count || 0,
      ]
    );

    // Create enrichment job for embedding generation
    try {
      await db.query(
        `
        INSERT INTO enrichment_jobs (client_id, content_id, content_type)
        VALUES ($1, $2, 'instagram_posts')
        ON CONFLICT (client_id, content_id, content_type) DO NOTHING
      `,
        [clientId, post.id]
      );
    } catch (enrichmentError) {
      logger.warn('Failed to create enrichment job for post', {
        postId: post.id,
        error: enrichmentError.message,
      });
    }

    insertCount++;
  }

  logger.sync(clientId, 'Instagram posts stored', { count: insertCount });
  return insertCount;
}

/**
 * Backfill carousel children for CAROUSEL_ALBUM posts
 */
async function backfillCarouselChildren(clientId) {
  logger.sync(clientId, 'Fetching carousel children');

  // Get all carousel posts
  const result = await db.query(
    `
    SELECT id, media_type
    FROM instagram_posts
    WHERE client_id = $1 AND media_type = 'CAROUSEL_ALBUM'
    ORDER BY timestamp DESC
  `,
    [clientId]
  );

  logger.sync(clientId, 'Found carousel posts', { count: result.rows.length });

  let childrenCount = 0;

  for (const row of result.rows) {
    try {
      logger.sync(clientId, 'Fetching children for carousel', { postId: row.id });

      const childrenResponse = await instagram.getCarouselChildren(clientId, row.id);
      const children = childrenResponse.data || [];

      logger.sync(clientId, 'Received carousel children', {
        postId: row.id,
        childrenCount: children.length,
      });

      for (const child of children) {
        await db.query(
          `
          INSERT INTO instagram_post_children (
            id, post_id, client_id, media_type, media_url, thumbnail_url, timestamp
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (id) DO UPDATE SET
            media_type = EXCLUDED.media_type,
            media_url = EXCLUDED.media_url,
            thumbnail_url = EXCLUDED.thumbnail_url,
            updated_at = NOW()
        `,
          [
            child.id,
            row.id,
            clientId,
            child.media_type,
            child.media_url || null,
            child.thumbnail_url || null,
            child.timestamp || null,
          ]
        );

        childrenCount++;
      }

      logger.sync(clientId, 'Stored children for carousel', {
        postId: row.id,
        childrenStored: children.length,
      });
    } catch (error) {
      logger.warn('Failed to fetch children for carousel', {
        postId: row.id,
        error: error.message,
      });
      // Continue with other carousels even if one fails
    }
  }

  logger.sync(clientId, 'Carousel children stored', { count: childrenCount });
  return childrenCount;
}

/**
 * Backfill post insights for all recent posts
 * Maps API metrics to specific database columns
 * Different metrics required for different media types
 */
async function backfillPostInsights(clientId) {
  logger.sync(clientId, 'Fetching post insights');

  // Get all posts with their media type
  const result = await db.query(
    `
    SELECT id, media_type, like_count, comments_count
    FROM instagram_posts
    WHERE client_id = $1
    AND is_deleted = FALSE
    ORDER BY timestamp DESC
  `,
    [clientId]
  );

  let insightsCount = 0;

  for (const row of result.rows) {
    try {
      // Request same metrics for all media types (API supports them)
      // VIDEO/IMAGE/CAROUSEL: reach, saved, total_interactions
      // VIDEO only: also supports 'views' (IMAGE/CAROUSEL don't have views metric)
      let metrics;
      if (row.media_type === 'VIDEO') {
        metrics = 'reach,saved,total_interactions,views';
      } else {
        // IMAGE and CAROUSEL_ALBUM (no views metric available)
        metrics = 'reach,saved,total_interactions';
      }

      const insights = await instagram.getMediaInsights(clientId, row.id, metrics);

      // Map API metrics to database columns
      const metricMap = {
        views: 0,
        reach: 0,
        saved: 0,
        total_interactions: 0,
      };

      // Extract values from API response
      for (const insight of insights.data || []) {
        const value = insight.values?.[0]?.value || 0;
        if (metricMap.hasOwnProperty(insight.name)) {
          metricMap[insight.name] = value;
        }
      }

      // Insert into database with column-based schema
      await db.query(
        `
        INSERT INTO instagram_post_insights (
          post_id, client_id, views, reach, saved, total_interactions,
          likes, comments, shares, snapshot_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_DATE)
        ON CONFLICT (post_id, snapshot_date)
        DO UPDATE SET
          views = EXCLUDED.views,
          reach = EXCLUDED.reach,
          saved = EXCLUDED.saved,
          total_interactions = EXCLUDED.total_interactions,
          likes = EXCLUDED.likes,
          comments = EXCLUDED.comments,
          shares = EXCLUDED.shares,
          updated_at = NOW()
      `,
        [
          row.id,
          clientId,
          metricMap.views,
          metricMap.reach,
          metricMap.saved,
          metricMap.total_interactions,
          row.like_count || 0,
          row.comments_count || 0,
          0, // shares not available from basic API
        ]
      );

      insightsCount++;
    } catch (error) {
      logger.warn('Failed to fetch insights for post', {
        postId: row.id,
        error: error.message,
      });
    }
  }

  logger.sync(clientId, 'Post insights stored', { count: insightsCount });
  return insightsCount;
}

/**
 * Backfill account insights (last 30 days)
 * Maps time-series and total_value metrics to column-based schema
 */
async function backfillAccountInsights(clientId) {
  logger.sync(clientId, 'Fetching account insights (30 days)');

  // Get account IDs
  const accountIds = await getAccountIds(clientId);
  const instagramBusinessAccountId = accountIds.instagram_business_account_id;

  // Get follower count from profile (not available in insights API)
  const profile = await instagram.getProfile(clientId);
  const currentFollowerCount = profile.followers_count || 0;

  const insights = await instagram.getAccountInsights(clientId, 'day');
  const period = insights.period || 'day';

  // Build a map of metrics by date
  const dateMetrics = {};

  for (const insight of insights.data || []) {
    const metricName = insight.name;

    if (insight.values && insight.values.length > 0) {
      // Time-series metrics have multiple values (one per day)
      if (metricName === 'reach') {
        for (const dataPoint of insight.values) {
          const date = dataPoint.end_time.split('T')[0]; // Extract date from timestamp
          if (!dateMetrics[date]) {
            dateMetrics[date] = { reach: 0, profile_views: 0, follower_count: 0 };
          }
          dateMetrics[date].reach = dataPoint.value || 0;
        }
      }
      // Total value metrics have a single cumulative value
      else if (metricName === 'profile_views') {
        const value = insight.values[0].value || 0;
        const today = new Date().toISOString().split('T')[0];
        if (!dateMetrics[today]) {
          dateMetrics[today] = { reach: 0, profile_views: 0, follower_count: 0 };
        }
        dateMetrics[today][metricName] = value;
      }
    }
  }

  // Insert one row per date, using current follower count from profile
  let insightsCount = 0;
  for (const [date, metrics] of Object.entries(dateMetrics)) {
    await db.query(
      `
      INSERT INTO instagram_account_insights (
        client_id, instagram_business_account_id, reach, profile_views,
        follower_count, snapshot_date, period
      ) VALUES ($1, $2, $3, $4, $5, $6::date, $7)
      ON CONFLICT (client_id, instagram_business_account_id, snapshot_date, period)
      DO UPDATE SET
        reach = EXCLUDED.reach,
        profile_views = EXCLUDED.profile_views,
        follower_count = EXCLUDED.follower_count
    `,
      [
        clientId,
        instagramBusinessAccountId,
        metrics.reach,
        metrics.profile_views,
        currentFollowerCount, // Use current follower count from profile
        date,
        period,
      ]
    );

    insightsCount++;
  }

  logger.sync(clientId, 'Account insights stored', { count: insightsCount });
  return insightsCount;
}

/**
 * Backfill audience demographics
 * Maps breakdown responses to JSONB columns
 */
async function backfillAudienceDemographics(clientId) {
  logger.sync(clientId, 'Fetching audience demographics');

  // Get account IDs
  const accountIds = await getAccountIds(clientId);
  const instagramBusinessAccountId = accountIds.instagram_business_account_id;

  const demographics = await instagram.getAudienceDemographics(clientId);

  // Build a map of breakdown types to their data
  const breakdownMap = {
    audience_city: null,
    audience_country: null,
    audience_gender_age: null,
    audience_locale: null,
  };

  // Extract data from API response
  for (const demo of demographics.data || []) {
    const breakdownData = demo.values?.[0]?.value || {};
    const dimensionKeys = demo.dimension_keys || [];

    // Map breakdown type to column name
    if (dimensionKeys.includes('city')) {
      breakdownMap.audience_city = JSON.stringify(breakdownData);
    } else if (dimensionKeys.includes('country')) {
      breakdownMap.audience_country = JSON.stringify(breakdownData);
    } else if (dimensionKeys.includes('age')) {
      breakdownMap.audience_gender_age = JSON.stringify(breakdownData);
    } else if (dimensionKeys.includes('gender')) {
      // Merge with age data if exists
      if (!breakdownMap.audience_gender_age) {
        breakdownMap.audience_gender_age = JSON.stringify(breakdownData);
      }
    }
  }

  // Insert single row with all demographics
  await db.query(
    `
    INSERT INTO instagram_audience_demographics (
      client_id, instagram_business_account_id, audience_city, audience_country,
      audience_gender_age, audience_locale, snapshot_date
    ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE)
    ON CONFLICT (client_id, instagram_business_account_id, snapshot_date)
    DO UPDATE SET
      audience_city = EXCLUDED.audience_city,
      audience_country = EXCLUDED.audience_country,
      audience_gender_age = EXCLUDED.audience_gender_age,
      audience_locale = EXCLUDED.audience_locale,
      updated_at = NOW()
  `,
    [
      clientId,
      instagramBusinessAccountId,
      breakdownMap.audience_city,
      breakdownMap.audience_country,
      breakdownMap.audience_gender_age,
      breakdownMap.audience_locale,
    ]
  );

  logger.sync(clientId, 'Audience demographics stored');
}

/**
 * Backfill ad campaigns (last 30 days)
 */
async function backfillAdCampaigns(clientId) {
  logger.sync(clientId, 'Fetching ad campaigns');

  // Get account IDs to get ad_account_id
  const accountIds = await getAccountIds(clientId);
  const adAccountId = accountIds.ad_account_id;

  if (!adAccountId) {
    logger.sync(clientId, 'No ad account ID found, skipping ad campaigns');
    return 0;
  }

  const campaignsResponse = await metaAds.getCampaigns(clientId);
  const campaigns = campaignsResponse.data || [];

  let insertCount = 0;

  for (const campaign of campaigns) {
    await db.query(
      `
      INSERT INTO ad_campaigns (
        id, client_id, ad_account_id, name, status, objective,
        daily_budget, lifetime_budget, start_time, stop_time
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id)
      DO UPDATE SET
        name = EXCLUDED.name,
        status = EXCLUDED.status,
        objective = EXCLUDED.objective,
        daily_budget = EXCLUDED.daily_budget,
        lifetime_budget = EXCLUDED.lifetime_budget,
        start_time = EXCLUDED.start_time,
        stop_time = EXCLUDED.stop_time,
        updated_at = NOW()
    `,
      [
        campaign.id,
        clientId,
        adAccountId,
        campaign.name,
        campaign.status,
        campaign.objective || null,
        campaign.daily_budget ? parseInt(campaign.daily_budget) : null,
        campaign.lifetime_budget ? parseInt(campaign.lifetime_budget) : null,
        campaign.start_time || null,
        campaign.stop_time || null,
      ]
    );

    insertCount++;
  }

  logger.sync(clientId, 'Ad campaigns stored', { count: insertCount });
  return insertCount;
}

/**
 * Backfill campaign insights (last 30 days)
 */
async function backfillCampaignInsights(clientId) {
  logger.sync(clientId, 'Fetching campaign insights');

  const datePreset = 'last_30d';

  // Get all campaigns (use 'id' column as primary key)
  const result = await db.query(
    `
    SELECT id as campaign_id
    FROM ad_campaigns
    WHERE client_id = $1
    AND is_deleted = FALSE
  `,
    [clientId]
  );

  let insightsCount = 0;

  for (const row of result.rows) {
    try {
      const insights = await metaAds.getCampaignInsights(clientId, row.campaign_id, datePreset);

      for (const insight of insights.data || []) {
        // Meta API returns spend, cpc, cpm as strings in cents (need to parse)
        // ctr is returned as string percentage (e.g., "1.5" = 1.5%)
        await db.query(
          `
          INSERT INTO ad_campaign_insights (
            client_id, campaign_id, snapshot_date, date_preset,
            spend, impressions, clicks, ctr, cpc, cpm, reach, conversions
          ) VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (campaign_id, snapshot_date, date_preset)
          DO UPDATE SET
            spend = EXCLUDED.spend,
            impressions = EXCLUDED.impressions,
            clicks = EXCLUDED.clicks,
            ctr = EXCLUDED.ctr,
            cpc = EXCLUDED.cpc,
            cpm = EXCLUDED.cpm,
            reach = EXCLUDED.reach,
            conversions = EXCLUDED.conversions,
            updated_at = NOW()
        `,
          [
            clientId,
            row.campaign_id,
            insight.date_start,
            datePreset,
            parseInt(insight.spend || 0),
            parseInt(insight.impressions || 0),
            parseInt(insight.clicks || 0),
            parseFloat(insight.ctr || 0),
            parseInt(insight.cpc || 0),
            parseInt(insight.cpm || 0),
            parseInt(insight.reach || 0),
            parseInt(insight.conversions || 0),
          ]
        );

        insightsCount++;
      }
    } catch (error) {
      logger.warn('Failed to fetch insights for campaign', {
        campaignId: row.campaign_id,
        error: error.message,
      });
    }
  }

  logger.sync(clientId, 'Campaign insights stored', { count: insightsCount });
  return insightsCount;
}

/**
 * Update sync status table
 */
async function updateSyncStatus(clientId, updates) {
  logger.sync(clientId, 'updateSyncStatus called', { updates });

  const fields = [];
  const values = [clientId];
  let paramIndex = 2;

  for (const [key, value] of Object.entries(updates)) {
    fields.push(`${key} = $${paramIndex}`);
    values.push(value);
    paramIndex++;
  }

  logger.sync(clientId, 'Executing sync_status query', { fields, values });

  const result = await db.query(
    `
    INSERT INTO sync_status (client_id, ${Object.keys(updates).join(', ')})
    VALUES ($1, ${Object.values(updates)
      .map((_, i) => `$${i + 2}`)
      .join(', ')})
    ON CONFLICT (client_id)
    DO UPDATE SET ${fields.join(', ')}, updated_at = NOW()
  `,
    values
  );

  logger.sync(clientId, 'sync_status query completed', { rowCount: result.rowCount });
}

module.exports = { execute };
