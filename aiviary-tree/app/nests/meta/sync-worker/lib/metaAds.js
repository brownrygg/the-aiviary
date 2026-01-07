const axios = require('axios');
const logger = require('./logger');
const { instagramRateLimiter } = require('./rateLimiter');
const { getClientCredentials } = require('./credentials');

const META_GRAPH_API_URL = 'https://graph.facebook.com/v21.0';

/**
 * Call Meta Ads API with rate limiting
 */
async function callMetaAdsAPI(endpoint, params = {}, accessToken) {
  const url = `${META_GRAPH_API_URL}${endpoint}`;

  return await instagramRateLimiter.execute(async () => {
    try {
      const response = await axios.get(url, {
        params: {
          access_token: accessToken,
          ...params,
        },
        timeout: 30000,
      });

      logger.api(endpoint, 'Meta Ads API call successful', {
        status: response.status,
        dataLength: response.data?.data?.length || 0,
      });

      return response.data;
    } catch (error) {
      const errorMessage = error.response?.data?.error?.message || error.message;
      const errorCode = error.response?.data?.error?.code;

      logger.error('Meta Ads API call failed', {
        endpoint,
        error: errorMessage,
        errorCode,
        status: error.response?.status,
      });

      throw new Error(`Meta Ads API Error: ${errorMessage}`);
    }
  });
}

/**
 * Get ad campaigns from ad account
 */
async function getCampaigns(clientId, limit = 100) {
  const credentials = await getClientCredentials(clientId);
  const adAccountId = credentials.platform_metadata?.ad_account_id;

  if (!adAccountId) {
    throw new Error('No ad account ID found');
  }

  const params = {
    fields: 'id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time,updated_time',
    limit: limit || 100,
  };

  return await callMetaAdsAPI(`/${adAccountId}/campaigns`, params, credentials.access_token);
}

/**
 * Get campaign insights (performance metrics)
 */
async function getCampaignInsights(clientId, campaignId, datePreset = 'last_30d') {
  const credentials = await getClientCredentials(clientId);

  const params = {
    fields: 'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,conversions,cost_per_conversion',
    date_preset: datePreset,
    time_increment: 1, // Daily breakdown
  };

  return await callMetaAdsAPI(`/${campaignId}/insights`, params, credentials.access_token);
}

/**
 * Get all campaigns with insights
 */
async function getCampaignsWithInsights(clientId, datePreset = 'last_30d') {
  const credentials = await getClientCredentials(clientId);
  const adAccountId = credentials.platform_metadata?.ad_account_id;

  if (!adAccountId) {
    throw new Error('No ad account ID found');
  }

  // Get campaigns
  const campaignsResponse = await getCampaigns(clientId);

  // Get insights for each campaign
  const campaignsWithInsights = await Promise.all(
    (campaignsResponse.data || []).map(async (campaign) => {
      try {
        const insights = await getCampaignInsights(clientId, campaign.id, datePreset);

        return {
          ...campaign,
          insights: insights.data || [],
        };
      } catch (error) {
        logger.warn('Failed to fetch insights for campaign', {
          campaignId: campaign.id,
          error: error.message,
        });

        return {
          ...campaign,
          insights: [],
          insights_error: error.message,
        };
      }
    })
  );

  return {
    data: campaignsWithInsights,
    paging: campaignsResponse.paging,
  };
}

/**
 * Get ad sets from campaign
 */
async function getAdSets(clientId, campaignId, limit = 100) {
  const credentials = await getClientCredentials(clientId);

  const params = {
    fields: 'id,name,status,daily_budget,lifetime_budget,optimization_goal,billing_event,bid_strategy,targeting,start_time,end_time,created_time,updated_time',
    limit: limit || 100,
  };

  return await callMetaAdsAPI(`/${campaignId}/adsets`, params, credentials.access_token);
}

/**
 * Get ads from ad set
 */
async function getAds(clientId, adSetId, limit = 100) {
  const credentials = await getClientCredentials(clientId);

  const params = {
    fields: 'id,name,status,creative,tracking_specs,conversion_specs,created_time,updated_time',
    limit: limit || 100,
  };

  return await callMetaAdsAPI(`/${adSetId}/ads`, params, credentials.access_token);
}

/**
 * Get ad insights (performance metrics)
 */
async function getAdInsights(clientId, adId, datePreset = 'last_30d') {
  const credentials = await getClientCredentials(clientId);

  const params = {
    fields: 'ad_id,ad_name,spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,conversions,cost_per_conversion',
    date_preset: datePreset,
    time_increment: 1, // Daily breakdown
  };

  return await callMetaAdsAPI(`/${adId}/insights`, params, credentials.access_token);
}

/**
 * Get ad account insights (account-level summary)
 */
async function getAdAccountInsights(clientId, datePreset = 'last_30d') {
  const credentials = await getClientCredentials(clientId);
  const adAccountId = credentials.platform_metadata?.ad_account_id;

  if (!adAccountId) {
    throw new Error('No ad account ID found');
  }

  const params = {
    fields: 'account_id,account_name,spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,conversions,cost_per_conversion',
    date_preset: datePreset,
    time_increment: 1, // Daily breakdown
  };

  return await callMetaAdsAPI(`/${adAccountId}/insights`, params, credentials.access_token);
}

/**
 * Get paginated results from Meta Ads API
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

/**
 * Get campaigns within date range
 */
async function getCampaignsByDateRange(clientId, startDate, endDate) {
  const credentials = await getClientCredentials(clientId);
  const adAccountId = credentials.platform_metadata?.ad_account_id;

  if (!adAccountId) {
    throw new Error('No ad account ID found');
  }

  const params = {
    fields: 'id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time,updated_time',
    filtering: JSON.stringify([
      {
        field: 'created_time',
        operator: 'GREATER_THAN',
        value: Math.floor(new Date(startDate).getTime() / 1000),
      },
      {
        field: 'created_time',
        operator: 'LESS_THAN',
        value: Math.floor(new Date(endDate).getTime() / 1000),
      },
    ]),
    limit: 100,
  };

  return await callMetaAdsAPI(`/${adAccountId}/campaigns`, params, credentials.access_token);
}

module.exports = {
  getCampaigns,
  getCampaignInsights,
  getCampaignsWithInsights,
  getAdSets,
  getAds,
  getAdInsights,
  getAdAccountInsights,
  getPaginatedResults,
  getCampaignsByDateRange,
  callMetaAdsAPI,
};
