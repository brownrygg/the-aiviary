const db = require('../lib/db');
const logger = require('../lib/logger');
const instagram = require('../lib/instagram');
const metaAds = require('../lib/metaAds');
const { getAccountIds } = require('../lib/credentials');

/**
 * Execute daily sync job - smart update strategy
 * Posts <7 days: Update daily
 * Posts 7-30 days: Update weekly (Mondays only)
 * Posts >30 days: On-demand only
 */
async function execute(job) {
  const { client_id } = job;
  const startTime = Date.now();

  logger.sync(client_id, 'Starting daily sync job', {
    jobId: job.id,
  });

  try {
    const accountIds = await getAccountIds(client_id);

    const stats = {
      instagram_profile: 0,
      instagram_follower_history: 0,
      new_posts: 0,
      updated_posts_daily: 0,
      updated_posts_weekly: 0,
      instagram_account_insights: 0,
      instagram_demographics: 0,
      ad_campaigns: 0,
      ad_campaign_insights: 0,
    };

    const isMonday = new Date().getDay() === 1;

    // 1. Update Instagram profile snapshot
    if (accountIds.instagram_business_account_id) {
      await updateInstagramProfile(client_id);
      stats.instagram_profile = 1;

      // 2. Record daily follower count
      await recordFollowerHistory(client_id);
      stats.instagram_follower_history = 1;

      // 3. Fetch new posts since last sync
      const newPostsCount = await syncNewPosts(client_id, accountIds.instagram_business_account_id);
      stats.new_posts = newPostsCount;

      // 4. Update insights for posts <7 days old (DAILY)
      const dailyUpdates = await updateRecentPostInsights(client_id, 7);
      stats.updated_posts_daily = dailyUpdates;

      // 5. Update insights for posts 7-30 days old (WEEKLY - Mondays only)
      if (isMonday) {
        const weeklyUpdates = await updateRecentPostInsights(client_id, 30, 7);
        stats.updated_posts_weekly = weeklyUpdates;
      }

      // 6. Update account insights (daily)
      const accountInsightsCount = await updateAccountInsights(client_id);
      stats.instagram_account_insights = accountInsightsCount;

      // 7. Update audience demographics (weekly - Mondays only)
      if (isMonday) {
        await updateAudienceDemographics(client_id);
        stats.instagram_demographics = 1;
      }
    }

    // 8. Sync ad campaigns and insights
    if (accountIds.ad_account_id) {
      const campaignCount = await syncAdCampaigns(client_id);
      stats.ad_campaigns = campaignCount;

      const insightsCount = await syncCampaignInsights(client_id);
      stats.ad_campaign_insights = insightsCount;
    }

    // Update sync status
    await updateSyncStatus(client_id, {
      last_instagram_sync: new Date().toISOString(),
      last_ads_sync: new Date().toISOString(),
      last_sync_error: null,
    });

    const duration = Date.now() - startTime;
    logger.sync(client_id, 'Daily sync completed successfully', {
      jobId: job.id,
      durationMs: duration,
      durationSeconds: Math.round(duration / 1000),
      stats,
      isMonday,
    });

    return { success: true, stats, duration };
  } catch (error) {
    logger.error('Daily sync job failed', {
      clientId: client_id,
      jobId: job.id,
      error: error.message,
      stack: error.stack,
    });

    await updateSyncStatus(client_id, {
      last_sync_error: error.message,
    });

    throw error;
  }
}

/**
 * Update Instagram profile snapshot
 */
async function updateInstagramProfile(clientId) {
  logger.sync(clientId, 'Updating Instagram profile');

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

  logger.sync(clientId, 'Profile updated', {
    followers: profile.followers_count,
  });
}

/**
 * Record daily follower count for growth tracking
 */
async function recordFollowerHistory(clientId) {
  const result = await db.query(
    `
    SELECT instagram_business_account_id, followers_count, follows_count
    FROM instagram_account_profile
    WHERE client_id = $1
  `,
    [clientId]
  );

  if (result.rows.length === 0) {
    logger.warn('No profile found for follower history', { clientId });
    return;
  }

  const { instagram_business_account_id, followers_count, follows_count } = result.rows[0];

  await db.query(
    `
    INSERT INTO instagram_follower_history (client_id, instagram_business_account_id, followers_count, follows_count, snapshot_date)
    VALUES ($1, $2, $3, $4, CURRENT_DATE)
    ON CONFLICT (client_id, instagram_business_account_id, snapshot_date)
    DO UPDATE SET
      followers_count = EXCLUDED.followers_count,
      follows_count = EXCLUDED.follows_count
  `,
    [clientId, instagram_business_account_id, followers_count, follows_count]
  );

  logger.sync(clientId, 'Follower history recorded', { followers: followers_count });
}

/**
 * Sync new posts since last sync
 */
async function syncNewPosts(clientId, instagramBusinessAccountId) {
  logger.sync(clientId, 'Fetching new posts');

  // Get timestamp of most recent post
  const lastPostResult = await db.query(
    `
    SELECT MAX(timestamp) as last_timestamp
    FROM instagram_posts
    WHERE client_id = $1
  `,
    [clientId]
  );

  const lastTimestamp = lastPostResult.rows[0]?.last_timestamp;
  const since = lastTimestamp ? new Date(lastTimestamp) : null;

  const mediaResponse = await instagram.getMedia(clientId, 25, since ? since.toISOString() : null);
  const posts = mediaResponse.data || [];

  let insertCount = 0;

  for (const post of posts) {
    const result = await db.query(
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
      RETURNING (xmax = 0) AS inserted
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

    // If inserted (not updated), fetch insights immediately
    if (result.rows[0].inserted) {
      insertCount++;

      try {
        // Request metrics based on media type
        let metrics;
        if (post.media_type === 'VIDEO') {
          metrics = 'reach,saved,total_interactions,views';
        } else {
          metrics = 'reach,saved,total_interactions';
        }

        const insights = await instagram.getMediaInsights(clientId, post.id, metrics);

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
          ON CONFLICT (post_id, snapshot_date) DO NOTHING
        `,
          [
            post.id,
            clientId,
            metricMap.views,
            metricMap.reach,
            metricMap.saved,
            metricMap.total_interactions,
            post.like_count || 0,
            post.comments_count || 0,
            0, // shares not available
          ]
        );

        // --- BEGIN FIX: Create enrichment job for the new post ---
        try {
          await db.query(
            `
            INSERT INTO enrichment_jobs (client_id, content_id, content_type)
            VALUES ($1, $2, 'instagram_posts')
            ON CONFLICT (client_id, content_id, content_type) DO NOTHING
          `,
            [clientId, post.id]
          );
          logger.sync(clientId, 'Enrichment job created for new post', { postId: post.id });
        } catch (enrichmentError) {
          logger.error('Failed to create enrichment job for new post', {
            postId: post.id,
            error: enrichmentError.message,
          });
        }
        // --- END FIX ---

        // --- BEGIN ADDITION: Handle Carousel Children ---
        if (post.media_type === 'CAROUSEL_ALBUM') {
          logger.sync(clientId, 'Carousel album detected, fetching children', { postId: post.id });
          try {
            const childrenResponse = await instagram.getCarouselChildren(clientId, post.id);
            const children = childrenResponse.data || [];

            for (const child of children) {
              try {
                await db.query(
                  `
                  INSERT INTO instagram_post_children (
                    id, post_id, client_id, media_type, media_url, thumbnail_url, timestamp
                  ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                  ON CONFLICT (id) DO NOTHING
                `,
                  [
                    child.id,
                    post.id,
                    clientId,
                    child.media_type,
                    child.media_url || null,
                    child.thumbnail_url || null,
                    child.timestamp || post.timestamp, // Fallback to parent timestamp
                  ]
                );
              } catch (dbError) {
                logger.error('Failed to insert carousel child into database', {
                  childId: child.id,
                  postId: post.id,
                  error: dbError.message,
                });
              }
            }
            logger.sync(clientId, 'Carousel children synced', { postId: post.id, count: children.length });
          } catch (carouselError) {
            logger.error('Failed to fetch or process carousel children', {
              postId: post.id,
              error: carouselError.message,
            });
          }
        }
        // --- END ADDITION ---

      } catch (error) {
        logger.warn('Failed to fetch insights for new post', {
          postId: post.id,
          error: error.message,
        });
      }
    }
  }

  logger.sync(clientId, 'New posts synced', { count: insertCount });
  return insertCount;
}

/**
 * Update insights for recent posts
 * @param maxAgeDays - Maximum age in days (e.g., 7 for posts <7 days)
 * @param minAgeDays - Minimum age in days (e.g., 7 for posts 7-30 days, default 0)
 */
async function updateRecentPostInsights(clientId, maxAgeDays, minAgeDays = 0) {
  logger.sync(clientId, `Updating insights for posts ${minAgeDays}-${maxAgeDays} days old`);

  const result = await db.query(
    `
    SELECT id, media_type, like_count, comments_count
    FROM instagram_posts
    WHERE client_id = $1
    AND is_deleted = FALSE
    AND timestamp > NOW() - INTERVAL '${maxAgeDays} days'
    AND timestamp <= NOW() - INTERVAL '${minAgeDays} days'
    ORDER BY timestamp DESC
  `,
    [clientId]
  );

  let updateCount = 0;

  for (const row of result.rows) {
    try {
      // Request metrics based on media type
      let metrics;
      if (row.media_type === 'VIDEO') {
        metrics = 'reach,saved,engagement,views';
      } else {
        metrics = 'reach,saved,engagement';
      }

      const insights = await instagram.getMediaInsights(clientId, row.id, metrics);

      // Map API metrics to database columns
      const metricMap = {
        views: 0,
        reach: 0,
        saved: 0,
        engagement: 0,
      };

      // Extract values from API response
      for (const insight of insights.data || []) {
        const value = insight.values?.[0]?.value || 0;
        if (metricMap.hasOwnProperty(insight.name)) {
          metricMap[insight.name] = value;
        }
      }

      // Insert into database with column-based schema
      // Note: API returns 'engagement' but we store it in 'total_interactions' column
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
          metricMap.engagement,  // API returns 'engagement', we store in 'total_interactions'
          row.like_count || 0,
          row.comments_count || 0,
          0, // shares not available
        ]
      );

      updateCount++;
    } catch (error) {
      logger.warn('Failed to update insights for post', {
        postId: row.id,
        error: error.message,
      });
    }
  }

  logger.sync(clientId, 'Post insights updated', { count: updateCount });
  return updateCount;
}

/**
 * Update account-level insights
 */
async function updateAccountInsights(clientId) {
  logger.sync(clientId, 'Updating account insights');

  // Get account IDs
  const accountIds = await getAccountIds(clientId);
  const instagramBusinessAccountId = accountIds.instagram_business_account_id;

  // Get follower count from profile
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
          const date = dataPoint.end_time.split('T')[0];
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

  // Insert one row per date
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
        currentFollowerCount,
        date,
        period,
      ]
    );

    insightsCount++;
  }

  logger.sync(clientId, 'Account insights updated', { count: insightsCount });
  return insightsCount;
}

/**
 * Update audience demographics (weekly)
 */
async function updateAudienceDemographics(clientId) {
  logger.sync(clientId, 'Updating audience demographics');

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

  logger.sync(clientId, 'Audience demographics updated');
}

/**
 * Sync ad campaigns (active daily, paused weekly)
 */
async function syncAdCampaigns(clientId) {
  logger.sync(clientId, 'Syncing ad campaigns');

  // Get account IDs
  const accountIds = await getAccountIds(clientId);
  const adAccountId = accountIds.ad_account_id;

  if (!adAccountId) {
    logger.sync(clientId, 'No ad account ID found, skipping ad campaigns');
    return 0;
  }

  const campaignsResponse = await metaAds.getCampaigns(clientId);
  const campaigns = campaignsResponse.data || [];

  let updateCount = 0;

  // Mark all existing campaigns as potentially deleted
  await db.query(
    `
    UPDATE ad_campaigns
    SET is_deleted = TRUE
    WHERE client_id = $1
  `,
    [clientId]
  );

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
        is_deleted = FALSE,
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

    updateCount++;
  }

  logger.sync(clientId, 'Ad campaigns synced', { count: updateCount });
  return updateCount;
}

/**
 * Sync campaign insights (active campaigns daily)
 */
async function syncCampaignInsights(clientId) {
  logger.sync(clientId, 'Syncing campaign insights');

  // Get active campaigns
  const result = await db.query(
    `
    SELECT id as campaign_id
    FROM ad_campaigns
    WHERE client_id = $1
    AND status = 'ACTIVE'
    AND is_deleted = FALSE
  `,
    [clientId]
  );

  let insightsCount = 0;

  for (const row of result.rows) {
    try {
      const insights = await metaAds.getCampaignInsights(clientId, row.campaign_id, 'yesterday');

      for (const insight of insights.data || []) {
        await db.query(
          `
          INSERT INTO ad_campaign_insights (
            client_id, campaign_id, date, spend, impressions, clicks,
            ctr, cpc, cpm, reach, conversions
          ) VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (client_id, campaign_id, date)
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
      logger.warn('Failed to sync insights for campaign', {
        campaignId: row.campaign_id,
        error: error.message,
      });
    }
  }

  logger.sync(clientId, 'Campaign insights synced', { count: insightsCount });
  return insightsCount;
}

/**
 * Update sync status table
 */
async function updateSyncStatus(clientId, updates) {
  const fields = [];
  const values = [clientId];
  let paramIndex = 2;

  for (const [key, value] of Object.entries(updates)) {
    fields.push(`${key} = $${paramIndex}`);
    values.push(value);
    paramIndex++;
  }

  await db.query(
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
}

module.exports = { execute };
