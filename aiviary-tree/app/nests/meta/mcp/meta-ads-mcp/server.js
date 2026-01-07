#!/usr/bin/env node

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const axios = require('axios');

// Configuration
const META_GRAPH_API_URL = 'https://graph.facebook.com/v21.0';
const CREDENTIAL_RECEIVER_URL = process.env.CREDENTIAL_RECEIVER_URL || 'http://credential-receiver:3006';

/**
 * Fetch OAuth credentials from credential-receiver
 */
async function getCredentials() {
  try {
    const response = await axios.get(`${CREDENTIAL_RECEIVER_URL}/api/credentials/token?platform=meta`);
    return response.data;
  } catch (error) {
    console.error('[Credentials Error]', error.response?.data || error.message);
    throw new Error('Failed to fetch Meta credentials from credential-receiver');
  }
}

/**
 * Call Meta Marketing API
 */
async function callMetaAdsAPI(endpoint, params = {}) {
  const credentials = await getCredentials();

  if (!credentials.access_token) {
    throw new Error('No access token available');
  }

  if (!credentials.platform_metadata?.ad_account_id) {
    throw new Error('No ad account connected');
  }

  if (credentials.token_expired) {
    console.error('[Warning] Access token is expired');
  }

  try {
    const response = await axios.get(`${META_GRAPH_API_URL}${endpoint}`, {
      params: {
        access_token: credentials.access_token,
        ...params,
      },
    });
    return response.data;
  } catch (error) {
    const errorMessage = error.response?.data?.error?.message || error.message;
    console.error('[Meta Ads API Error]', errorMessage);
    throw new Error(`Meta Ads API Error: ${errorMessage}`);
  }
}

/**
 * Get ad campaigns
 */
async function getCampaigns(status = 'ACTIVE', limit = 25) {
  const credentials = await getCredentials();
  const adAccountId = credentials.platform_metadata?.ad_account_id;

  const params = {
    fields: 'id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time,updated_time',
    limit: limit || 25,
  };

  if (status && status !== 'ALL') {
    params.filtering = JSON.stringify([{
      field: 'status',
      operator: 'IN',
      value: [status]
    }]);
  }

  return await callMetaAdsAPI(`/${adAccountId}/campaigns`, params);
}

/**
 * Get campaign insights (performance metrics)
 */
async function getCampaignInsights(campaignId, datePreset = 'last_7d', metrics = null) {
  const defaultMetrics = 'spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,conversions,cost_per_action_type';
  const fieldsToFetch = metrics || defaultMetrics;

  const params = {
    fields: fieldsToFetch,
    date_preset: datePreset || 'last_7d', // today, yesterday, last_7d, last_30d, lifetime
    level: 'campaign',
  };

  return await callMetaAdsAPI(`/${campaignId}/insights`, params);
}

/**
 * Get ad sets for a campaign
 */
async function getAdSets(campaignId, status = 'ACTIVE', limit = 25) {
  const params = {
    fields: 'id,name,status,daily_budget,lifetime_budget,start_time,end_time,targeting,optimization_goal,billing_event',
    limit: limit || 25,
  };

  if (status && status !== 'ALL') {
    params.filtering = JSON.stringify([{
      field: 'status',
      operator: 'IN',
      value: [status]
    }]);
  }

  return await callMetaAdsAPI(`/${campaignId}/adsets`, params);
}

/**
 * Get ads for an ad set
 */
async function getAds(adSetId, status = 'ACTIVE', limit = 25) {
  const params = {
    fields: 'id,name,status,creative,tracking_specs,conversion_specs',
    limit: limit || 25,
  };

  if (status && status !== 'ALL') {
    params.filtering = JSON.stringify([{
      field: 'status',
      operator: 'IN',
      value: [status]
    }]);
  }

  return await callMetaAdsAPI(`/${adSetId}/ads`, params);
}

/**
 * Get ad insights (performance for specific ad)
 */
async function getAdInsights(adId, datePreset = 'last_7d', metrics = null) {
  const defaultMetrics = 'spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,conversions';
  const fieldsToFetch = metrics || defaultMetrics;

  const params = {
    fields: fieldsToFetch,
    date_preset: datePreset || 'last_7d',
    level: 'ad',
  };

  return await callMetaAdsAPI(`/${adId}/insights`, params);
}

/**
 * Get account insights (overall ad account performance)
 */
async function getAccountInsights(datePreset = 'last_30d', metrics = null) {
  const credentials = await getCredentials();
  const adAccountId = credentials.ad_account_id;

  const defaultMetrics = 'spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,conversions,cost_per_action_type';
  const fieldsToFetch = metrics || defaultMetrics;

  const params = {
    fields: fieldsToFetch,
    date_preset: datePreset || 'last_30d',
    level: 'account',
  };

  return await callMetaAdsAPI(`/${adAccountId}/insights`, params);
}

// ============================================================================
// MCP SERVER SETUP
// ============================================================================

const server = new Server(
  {
    name: 'meta-ads-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// LIST AVAILABLE TOOLS
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'get_campaigns',
        description: 'Get ad campaigns from your Meta Ads account with budget and status info',
        inputSchema: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              description: 'Filter by status: ACTIVE, PAUSED, ARCHIVED, or ALL. Default: ACTIVE',
            },
            limit: {
              type: 'integer',
              description: 'Number of campaigns to return (1-100). Default: 25',
            },
          },
          required: [],
        },
      },
      {
        name: 'get_campaign_insights',
        description: 'Get performance metrics for a specific campaign (spend, impressions, clicks, conversions, ROAS)',
        inputSchema: {
          type: 'object',
          properties: {
            campaign_id: {
              type: 'string',
              description: 'Campaign ID',
            },
            date_preset: {
              type: 'string',
              description: 'Date range: today, yesterday, last_7d, last_30d, lifetime. Default: last_7d',
            },
            metrics: {
              type: 'string',
              description: 'Comma-separated metrics to fetch. Default: spend,impressions,clicks,ctr,cpc,cpm,conversions',
            },
          },
          required: ['campaign_id'],
        },
      },
      {
        name: 'get_adsets',
        description: 'Get ad sets for a campaign with targeting and optimization settings',
        inputSchema: {
          type: 'object',
          properties: {
            campaign_id: {
              type: 'string',
              description: 'Campaign ID',
            },
            status: {
              type: 'string',
              description: 'Filter by status: ACTIVE, PAUSED, or ALL. Default: ACTIVE',
            },
            limit: {
              type: 'integer',
              description: 'Number of ad sets to return (1-100). Default: 25',
            },
          },
          required: ['campaign_id'],
        },
      },
      {
        name: 'get_ads',
        description: 'Get individual ads for an ad set with creative and tracking details',
        inputSchema: {
          type: 'object',
          properties: {
            adset_id: {
              type: 'string',
              description: 'Ad Set ID',
            },
            status: {
              type: 'string',
              description: 'Filter by status: ACTIVE, PAUSED, or ALL. Default: ACTIVE',
            },
            limit: {
              type: 'integer',
              description: 'Number of ads to return (1-100). Default: 25',
            },
          },
          required: ['adset_id'],
        },
      },
      {
        name: 'get_ad_insights',
        description: 'Get performance metrics for a specific ad',
        inputSchema: {
          type: 'object',
          properties: {
            ad_id: {
              type: 'string',
              description: 'Ad ID',
            },
            date_preset: {
              type: 'string',
              description: 'Date range: today, yesterday, last_7d, last_30d, lifetime. Default: last_7d',
            },
            metrics: {
              type: 'string',
              description: 'Comma-separated metrics. Default: spend,impressions,clicks,ctr,cpc,conversions',
            },
          },
          required: ['ad_id'],
        },
      },
      {
        name: 'get_account_insights',
        description: 'Get overall ad account performance metrics (total spend, impressions, conversions across all campaigns)',
        inputSchema: {
          type: 'object',
          properties: {
            date_preset: {
              type: 'string',
              description: 'Date range: today, yesterday, last_7d, last_30d, lifetime. Default: last_30d',
            },
            metrics: {
              type: 'string',
              description: 'Comma-separated metrics. Default: spend,impressions,clicks,ctr,cpc,conversions',
            },
          },
          required: [],
        },
      },
    ],
  };
});

// HANDLE TOOL CALLS
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;

    switch (name) {
      case 'get_campaigns': {
        const { status, limit } = args;
        result = await getCampaigns(status, limit);
        break;
      }

      case 'get_campaign_insights': {
        const { campaign_id, date_preset, metrics } = args;
        result = await getCampaignInsights(campaign_id, date_preset, metrics);
        break;
      }

      case 'get_adsets': {
        const { campaign_id, status, limit } = args;
        result = await getAdSets(campaign_id, status, limit);
        break;
      }

      case 'get_ads': {
        const { adset_id, status, limit } = args;
        result = await getAds(adset_id, status, limit);
        break;
      }

      case 'get_ad_insights': {
        const { ad_id, date_preset, metrics } = args;
        result = await getAdInsights(ad_id, date_preset, metrics);
        break;
      }

      case 'get_account_insights': {
        const { date_preset, metrics } = args;
        result = await getAccountInsights(date_preset, metrics);
        break;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// START SERVER
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Meta Ads MCP server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
