#!/usr/bin/env node

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const axios = require('axios');

// Configuration
const INSTAGRAM_GRAPH_API_URL = 'https://graph.facebook.com/v21.0';
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
 * Call Instagram Graph API
 */
async function callInstagramAPI(endpoint, params = {}) {
  const credentials = await getCredentials();

  if (!credentials.access_token) {
    throw new Error('No access token available');
  }

  if (!credentials.platform_metadata?.instagram_business_account_id) {
    throw new Error('No Instagram business account connected');
  }

  if (credentials.token_expired) {
    console.error('[Warning] Access token is expired');
  }

  try {
    const response = await axios.get(`${INSTAGRAM_GRAPH_API_URL}${endpoint}`, {
      params: {
        access_token: credentials.access_token,
        ...params,
      },
    });
    return response.data;
  } catch (error) {
    const errorMessage = error.response?.data?.error?.message || error.message;
    console.error('[Instagram API Error]', errorMessage);
    throw new Error(`Instagram API Error: ${errorMessage}`);
  }
}

/**
 * Get recent Instagram media (posts)
 */
async function getMedia(limit = 25, since = null) {
  const credentials = await getCredentials();
  const igUserId = credentials.platform_metadata?.instagram_business_account_id;

  const params = {
    fields: 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,username,like_count,comments_count',
    limit: limit || 25,
  };

  if (since) {
    params.since = new Date(since).getTime() / 1000; // Convert to Unix timestamp
  }

  return await callInstagramAPI(`/${igUserId}/media`, params);
}

/**
 * Get insights for a specific media post
 */
async function getMediaInsights(mediaId, metrics = null) {
  // Valid metrics according to Instagram API (as of April 2025)
  // 'views' replaced 'impressions' and 'plays' - works for all media types
  const defaultMetrics = 'views,reach,saved,total_interactions';
  const metricsToFetch = metrics || defaultMetrics;

  const params = {
    metric: metricsToFetch,
  };

  return await callInstagramAPI(`/${mediaId}/insights`, params);
}

/**
 * Get profile data (actual follower count, bio, etc.)
 */
async function getProfile() {
  const credentials = await getCredentials();
  const igUserId = credentials.platform_metadata?.instagram_business_account_id;

  const params = {
    fields: 'id,username,name,biography,followers_count,follows_count,media_count,profile_picture_url,website',
  };

  return await callInstagramAPI(`/${igUserId}`, params);
}

/**
 * Get account-level insights (daily/weekly metrics)
 * Note: follower_count in insights is the DAILY CHANGE, not total count
 * Use getProfile() to get the actual follower count
 */
async function getProfileInsights(period = 'day', metrics = null) {
  const credentials = await getCredentials();
  const igUserId = credentials.platform_metadata?.instagram_business_account_id;

  // Updated valid metrics for 2025 API
  // Note: 'impressions' removed - use 'reach' instead
  const defaultMetrics = 'reach,profile_views,follower_count';
  const metricsToFetch = metrics || defaultMetrics;

  const params = {
    metric: metricsToFetch,
    period: period || 'day', // day, week, days_28
  };

  return await callInstagramAPI(`/${igUserId}/insights`, params);
}

/**
 * Get audience demographics (follower insights)
 */
async function getAudienceDemographics(breakdown = 'age,gender') {
  const credentials = await getCredentials();
  const igUserId = credentials.platform_metadata?.instagram_business_account_id;

  const params = {
    metric: 'audience_city,audience_country,audience_gender_age,audience_locale',
    period: 'lifetime',
  };

  return await callInstagramAPI(`/${igUserId}/insights`, params);
}

/**
 * Get media with insights (combined call)
 */
async function getMediaWithInsights(limit = 10) {
  const credentials = await getCredentials();
  const igUserId = credentials.platform_metadata?.instagram_business_account_id;

  // First get recent media
  const mediaResponse = await callInstagramAPI(`/${igUserId}/media`, {
    fields: 'id,caption,media_type,permalink,timestamp,like_count,comments_count',
    limit: limit || 10,
  });

  // Then get insights for each media
  const mediaWithInsights = await Promise.all(
    mediaResponse.data.map(async (media) => {
      try {
        // As of April 2025, 'views' is the unified metric for all media types
        // Replaces deprecated 'impressions' and 'plays' metrics
        const metrics = 'views,reach,saved,total_interactions,likes,comments,shares';

        const insights = await callInstagramAPI(`/${media.id}/insights`, {
          metric: metrics,
        });

        return {
          ...media,
          insights: insights.data,
        };
      } catch (error) {
        // Some media types don't support insights
        console.error(`[Insights Error for ${media.id}]`, error.message);
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

// ============================================================================
// MCP SERVER SETUP
// ============================================================================

const server = new Server(
  {
    name: 'instagram-analytics-mcp',
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
        name: 'get_profile',
        description: 'Get Instagram account profile data including ACTUAL follower count, bio, username, and media count',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'get_media',
        description: 'Get recent Instagram posts from your business account with engagement metrics (likes, comments)',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'integer',
              description: 'Number of posts to return (1-100). Default: 25',
            },
            since: {
              type: 'string',
              description: 'ISO date to fetch posts after (e.g., "2025-12-01"). Optional',
            },
          },
          required: [],
        },
      },
      {
        name: 'get_media_insights',
        description: 'Get detailed performance insights for a specific Instagram post (views, reach, engagement, saves)',
        inputSchema: {
          type: 'object',
          properties: {
            media_id: {
              type: 'string',
              description: 'Instagram media ID',
            },
            metrics: {
              type: 'string',
              description: 'Comma-separated metrics: views,reach,saved,total_interactions. Default: all',
            },
          },
          required: ['media_id'],
        },
      },
      {
        name: 'get_profile_insights',
        description: 'Get account-level Instagram insights - daily/weekly changes (reach, profile views, follower GROWTH). Note: For actual follower COUNT use get_profile',
        inputSchema: {
          type: 'object',
          properties: {
            period: {
              type: 'string',
              description: 'Time period: day, week, days_28. Default: day',
            },
            metrics: {
              type: 'string',
              description: 'Comma-separated metrics: reach,profile_views,follower_count (daily change). Default: all',
            },
          },
          required: [],
        },
      },
      {
        name: 'get_audience_demographics',
        description: 'Get follower demographics (age, gender, location, locale distribution)',
        inputSchema: {
          type: 'object',
          properties: {
            breakdown: {
              type: 'string',
              description: 'Breakdown type: age, gender, city, country. Default: age,gender',
            },
          },
          required: [],
        },
      },
      {
        name: 'get_media_with_insights',
        description: 'Get recent posts WITH their insights in one call - great for performance analysis',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'integer',
              description: 'Number of posts to return with insights (1-25). Default: 10',
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
      case 'get_profile': {
        result = await getProfile();
        break;
      }

      case 'get_media': {
        const { limit, since } = args;
        result = await getMedia(limit, since);
        break;
      }

      case 'get_media_insights': {
        const { media_id, metrics } = args;
        result = await getMediaInsights(media_id, metrics);
        break;
      }

      case 'get_profile_insights': {
        const { period, metrics } = args;
        result = await getProfileInsights(period, metrics);
        break;
      }

      case 'get_audience_demographics': {
        const { breakdown } = args;
        result = await getAudienceDemographics(breakdown);
        break;
      }

      case 'get_media_with_insights': {
        const { limit } = args;
        result = await getMediaWithInsights(limit);
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
  console.error('Instagram Analytics MCP server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
