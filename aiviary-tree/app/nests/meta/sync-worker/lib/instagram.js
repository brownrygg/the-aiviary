const axios = require('axios');
const logger = require('./logger');
const { instagramRateLimiter } = require('./rateLimiter');
const { getClientCredentials } = require('./credentials');

const INSTAGRAM_GRAPH_API_URL = 'https://graph.facebook.com/v21.0';

/**
 * Call Instagram Graph API with rate limiting
 */
async function callInstagramAPI(endpoint, params = {}, accessToken) {
  const url = `${INSTAGRAM_GRAPH_API_URL}${endpoint}`;

  return await instagramRateLimiter.execute(async () => {
    try {
      const response = await axios.get(url, {
        params: {
          access_token: accessToken,
          ...params,
        },
        timeout: 30000,
      });

      logger.api(endpoint, 'Instagram API call successful', {
        status: response.status,
        dataLength: response.data?.data?.length || 0,
      });

      return response.data;
    } catch (error) {
      const errorMessage = error.response?.data?.error?.message || error.message;
      const errorCode = error.response?.data?.error?.code;

      logger.error('Instagram API call failed', {
        endpoint,
        error: errorMessage,
        errorCode,
        status: error.response?.status,
      });

      throw new Error(`Instagram API Error: ${errorMessage}`);
    }
  });
}

/**
 * Get Instagram account profile
 */
async function getProfile(clientId) {
  const credentials = await getClientCredentials(clientId);
  const igUserId = credentials.platform_metadata?.instagram_business_account_id;

  if (!igUserId) {
    throw new Error('No Instagram business account ID found');
  }

  const params = {
    fields: 'id,username,name,biography,followers_count,follows_count,media_count,profile_picture_url,website',
  };

  return await callInstagramAPI(`/${igUserId}`, params, credentials.access_token);
}

/**
 * Get Instagram media (posts)
 */
async function getMedia(clientId, limit = 25, since = null) {
  const credentials = await getClientCredentials(clientId);
  const igUserId = credentials.platform_metadata?.instagram_business_account_id;

  if (!igUserId) {
    throw new Error('No Instagram business account ID found');
  }

  const params = {
    fields: 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,username,like_count,comments_count,children',
    limit: limit || 25,
  };

  if (since) {
    params.since = Math.floor(new Date(since).getTime() / 1000); // Unix timestamp
  }

  return await callInstagramAPI(`/${igUserId}/media`, params, credentials.access_token);
}

/**
 * --- BEGIN NEW FUNCTION ---
 * Get children media for a carousel album post
 */
async function getCarouselChildren(clientId, mediaId) {
  const credentials = await getClientCredentials(clientId);

  const params = {
    fields: 'id,media_type,media_url,thumbnail_url,timestamp',
  };

  return await callInstagramAPI(`/${mediaId}/children`, params, credentials.access_token);
}
/**
 * --- END NEW FUNCTION ---
 */

/**
 * Get insights for a specific media post
 */
async function getMediaInsights(clientId, mediaId, metrics = null) {
  const credentials = await getClientCredentials(clientId);

  // Updated metrics for 2025 API (views replaces impressions/plays)
  const defaultMetrics = 'views,reach,saved,total_interactions';
  const metricsToFetch = metrics || defaultMetrics;

  const params = {
    metric: metricsToFetch,
  };

  return await callInstagramAPI(`/${mediaId}/insights`, params, credentials.access_token);
}

/**
 * Get account-level insights
 * Note: Instagram API has TWO types of metrics:
 * - Time-series metrics (reach) require 'period' parameter
 * - Total value metrics (profile_views, follower_count) require 'metric_type=total_value'
 */
async function getAccountInsights(clientId, period = 'day') {
  const credentials = await getClientCredentials(clientId);
  const igUserId = credentials.platform_metadata?.instagram_business_account_id;

  if (!igUserId) {
    throw new Error('No Instagram business account ID found');
  }

  // Fetch time-series metrics (require period)
  let timeSeriesData = null;
  try {
    const timeSeriesParams = {
      metric: 'reach',
      period: period || 'day',
    };
    timeSeriesData = await callInstagramAPI(`/${igUserId}/insights`, timeSeriesParams, credentials.access_token);
  } catch (error) {
    logger.warn('Failed to fetch time-series account insights', { error: error.message });
  }

  // Fetch total value metrics (require both metric_type AND period)
  // Note: follower_count is NOT an insights metric - it comes from profile endpoint
  let totalValueData = null;
  try {
    const totalValueParams = {
      metric: 'profile_views',
      metric_type: 'total_value',
      period: 'day', // Required even for total_value metrics
    };
    totalValueData = await callInstagramAPI(`/${igUserId}/insights`, totalValueParams, credentials.access_token);
  } catch (error) {
    logger.warn('Failed to fetch total value account insights', { error: error.message });
  }

  // Combine results
  const combinedData = [];
  if (timeSeriesData?.data) combinedData.push(...timeSeriesData.data);
  if (totalValueData?.data) combinedData.push(...totalValueData.data);

  return {
    data: combinedData,
    period: period,
  };
}

/**
 * Get audience demographics
 * Updated for 2025 API - old metrics deprecated, using new metric names
 */
async function getAudienceDemographics(clientId) {
  const credentials = await getClientCredentials(clientId);
  const igUserId = credentials.platform_metadata?.instagram_business_account_id;

  if (!igUserId) {
    throw new Error('No Instagram business account ID found');
  }

  // Updated demographic metrics for API v21+ (requires metric_type, period, AND breakdown)
  // Fetch multiple breakdowns separately since API requires specific breakdown parameter
  const breakdowns = ['city', 'country', 'age', 'gender'];
  const allData = [];

  for (const breakdown of breakdowns) {
    try {
      const params = {
        metric: 'follower_demographics',
        metric_type: 'total_value',
        period: 'lifetime',
        breakdown: breakdown,
      };

      const response = await callInstagramAPI(`/${igUserId}/insights`, params, credentials.access_token);
      if (response.data) {
        allData.push(...response.data);
      }
    } catch (error) {
      logger.warn(`Failed to fetch ${breakdown} demographics`, { error: error.message });
    }
  }

  return { data: allData };
}

/**
 * Get media with insights (batch operation)
 */
async function getMediaWithInsights(clientId, limit = 10) {
  const credentials = await getClientCredentials(clientId);
  const igUserId = credentials.platform_metadata?.instagram_business_account_id;

  if (!igUserId) {
    throw new Error('No Instagram business account ID found');
  }

  // First get recent media
  const mediaResponse = await callInstagramAPI(
    `/${igUserId}/media`,
    {
      fields: 'id,caption,media_type,permalink,timestamp,like_count,comments_count',
      limit: limit || 10,
    },
    credentials.access_token
  );

  // Then get insights for each media
  const mediaWithInsights = await Promise.all(
    (mediaResponse.data || []).map(async (media) => {
      try {
        const metrics = 'views,reach,saved,total_interactions,likes,comments,shares';
        const insights = await callInstagramAPI(
          `/${media.id}/insights`,
          { metric: metrics },
          credentials.access_token
        );

        return {
          ...media,
          insights: insights.data,
        };
      } catch (error) {
        logger.warn('Failed to fetch insights for media', {
          mediaId: media.id,
          error: error.message,
        });

        return {
          ...media,
          insights: null,
          insights_error: error.message,
        };
      }
    })
  );

  return {
    data: mediaWithInsights,
    paging: mediaResponse.paging,
  };
}

/**
 * Get paginated results from Instagram API
 */
async function getPaginatedResults(clientId, initialUrl, maxPages = 10) {
  const credentials = await getClientCredentials(clientId);
  const results = [];
  let nextUrl = initialUrl;
  let pageCount = 0;

  while (nextUrl && pageCount < maxPages) {
    const response = await instagramRateLimiter.execute(async () => {
      return await axios.get(nextUrl, {
        params: { access_token: credentials.access_token },
        timeout: 30000,
      });
    });

    if (response.data.data) {
      results.push(...response.data.data);
    }

    nextUrl = response.data.paging?.next || null;
    pageCount++;

    logger.debug('Fetched paginated page', {
      pageNumber: pageCount,
      itemsOnPage: response.data.data?.length || 0,
      hasMore: !!nextUrl,
    });
  }

  return results;
}

module.exports = {
  getProfile,
  getMedia,
  getCarouselChildren,
  getMediaInsights,
  getAccountInsights,
  getAudienceDemographics,
  getMediaWithInsights,
  getPaginatedResults,
  callInstagramAPI,
};
