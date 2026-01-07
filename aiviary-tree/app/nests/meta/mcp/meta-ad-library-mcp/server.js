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
 * Call Meta Ad Library API
 */
async function callAdLibraryAPI(endpoint, params = {}) {
  // Fetch fresh credentials
  const credentials = await getCredentials();

  if (!credentials.access_token) {
    throw new Error('No access token available');
  }

  // Check if user has completed Identity Verification for Ad Library access
  if (!credentials.platform_metadata?.ad_library_verified) {
    const errorMessage =
      '⛔ ACTION REQUIRED: Meta Ad Library Access Not Enabled\n\n' +
      'To use the Ad Library search feature, you must complete Identity Verification with Meta.\n\n' +
      '📋 Steps to Enable:\n' +
      '1. Visit https://facebook.com/id\n' +
      '2. Upload a government-issued ID (passport, driver\'s license, etc.)\n' +
      '3. Wait for Meta to verify (usually 24-48 hours)\n' +
      '4. Reconnect your account in the app\n\n' +
      '💡 Why is this required?\n' +
      'Meta requires Identity Verification to prevent misuse of the Ad Library API ' +
      'for election interference and to comply with transparency regulations.\n\n' +
      '✅ If you\'re already verified for running ads, you should be all set! ' +
      'Just visit the link above to confirm your verification status.\n\n' +
      'Note: This is a Meta requirement, not ours. We don\'t have control over this process.';

    throw new Error(errorMessage);
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
    const errorCode = error.response?.data?.error?.error_subcode;

    // Check if this is the verification error from Meta (in case our check didn't catch it)
    if (errorCode === 2332002 || errorMessage.includes('verify their identity')) {
      const helpMessage =
        '⛔ Meta Identity Verification Required\n\n' +
        'Meta rejected this request because your account is not verified.\n' +
        'Please visit https://facebook.com/id to complete Identity Verification.\n\n' +
        'After verification is complete, reconnect your account in the app.';
      throw new Error(helpMessage);
    }

    console.error('[Meta Ad Library API Error]', errorMessage);
    throw new Error(`Meta Ad Library API Error: ${errorMessage}`);
  }
}

/**
 * Search ads in Meta Ad Library
 */
async function searchAds(searchTerms, options = {}) {
  const params = {
    search_terms: searchTerms,
    ad_reached_countries: options.country || 'US',
    ad_active_status: options.status || 'ALL',
    limit: options.limit || 25,
    fields: 'id,ad_creation_time,ad_creative_bodies,ad_creative_link_captions,ad_creative_link_descriptions,ad_creative_link_titles,ad_delivery_start_time,ad_delivery_stop_time,ad_snapshot_url,page_name,publisher_platforms,languages',
  };

  return await callAdLibraryAPI('/ads_archive', params);
}

/**
 * Get ads from specific advertiser
 */
async function getAdvertiserAds(advertiserName, options = {}) {
  const params = {
    search_terms: advertiserName,
    ad_reached_countries: options.country || 'US',
    ad_active_status: options.status || 'ACTIVE',
    search_page_ids: options.pageId || undefined,
    limit: options.limit || 25,
    fields: 'id,ad_creation_time,ad_creative_bodies,ad_creative_link_captions,ad_creative_link_descriptions,ad_creative_link_titles,ad_delivery_start_time,ad_delivery_stop_time,ad_snapshot_url,page_name,publisher_platforms,impressions,spend,languages',
  };

  return await callAdLibraryAPI('/ads_archive', params);
}

/**
 * Analyze ad longevity (how long ads have been running)
 */
async function analyzeAdLongevity(advertiserName, minDaysActive = 30, country = 'US') {
  const ads = await getAdvertiserAds(advertiserName, {
    status: 'ACTIVE',
    country,
    limit: 100
  });

  if (!ads.data || ads.data.length === 0) {
    return { message: 'No active ads found for this advertiser', ads: [] };
  }

  const now = new Date();
  const longRunningAds = ads.data
    .map(ad => {
      const startDate = new Date(ad.ad_delivery_start_time);
      const daysActive = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      return { ...ad, days_active: daysActive };
    })
    .filter(ad => ad.days_active >= minDaysActive)
    .sort((a, b) => b.days_active - a.days_active);

  return {
    total_active_ads: ads.data.length,
    long_running_ads: longRunningAds.length,
    min_days_filter: minDaysActive,
    ads: longRunningAds,
  };
}

/**
 * Find trending ad formats in an industry
 */
async function getTrendingCreatives(industryKeywords, country = 'US', limit = 50) {
  const ads = await searchAds(industryKeywords, {
    status: 'ACTIVE',
    country,
    limit
  });

  if (!ads.data || ads.data.length === 0) {
    return { message: 'No ads found for these keywords', analysis: null };
  }

  // Analyze platform distribution
  const platformCounts = {};
  const pageCounts = {};

  ads.data.forEach(ad => {
    // Count platforms
    if (ad.publisher_platforms) {
      ad.publisher_platforms.forEach(platform => {
        platformCounts[platform] = (platformCounts[platform] || 0) + 1;
      });
    }

    // Count advertisers
    if (ad.page_name) {
      pageCounts[ad.page_name] = (pageCounts[ad.page_name] || 0) + 1;
    }
  });

  return {
    total_ads_analyzed: ads.data.length,
    platform_distribution: platformCounts,
    top_advertisers: Object.entries(pageCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ advertiser: name, ad_count: count })),
    sample_ads: ads.data.slice(0, 10),
  };
}

// ============================================================================
// MCP SERVER SETUP
// ============================================================================

const server = new Server(
  {
    name: 'meta-ad-library-mcp',
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
        name: 'search_ads',
        description: 'Search Meta Ad Library for ads by keyword, advertiser, or industry. Returns active and inactive ads from Facebook/Instagram.',
        inputSchema: {
          type: 'object',
          properties: {
            search_terms: {
              type: 'string',
              description: 'Keywords to search for in ad text or advertiser name',
            },
            country: {
              type: 'string',
              description: 'Country code (e.g., "US", "GB", "CA"). Default: US',
            },
            status: {
              type: 'string',
              description: 'Filter by status: ALL, ACTIVE, or INACTIVE. Default: ALL',
            },
            limit: {
              type: 'integer',
              description: 'Maximum number of ads to return (1-100). Default: 25',
            },
          },
          required: ['search_terms'],
        },
      },
      {
        name: 'get_advertiser_ads',
        description: 'Get all ads from a specific advertiser/competitor. Useful for competitive analysis.',
        inputSchema: {
          type: 'object',
          properties: {
            advertiser_name: {
              type: 'string',
              description: 'Exact or partial advertiser/page name to search for',
            },
            status: {
              type: 'string',
              description: 'ACTIVE (currently running) or ALL (including past ads). Default: ACTIVE',
            },
            country: {
              type: 'string',
              description: 'Country code (e.g., "US"). Default: US',
            },
            limit: {
              type: 'integer',
              description: 'Maximum number of ads to return (1-100). Default: 25',
            },
          },
          required: ['advertiser_name'],
        },
      },
      {
        name: 'analyze_ad_longevity',
        description: 'Analyze how long ads have been running. Ads running 90+ days are likely profitable. Great for finding proven winners.',
        inputSchema: {
          type: 'object',
          properties: {
            advertiser_name: {
              type: 'string',
              description: 'Advertiser to analyze',
            },
            min_days_active: {
              type: 'integer',
              description: 'Minimum days ad must be running to include (e.g., 90 for proven winners). Default: 30',
            },
            country: {
              type: 'string',
              description: 'Country code (e.g., "US"). Default: US',
            },
          },
          required: ['advertiser_name'],
        },
      },
      {
        name: 'get_trending_creatives',
        description: 'Discover trending ad formats and top advertisers in an industry. Analyze platform distribution and identify patterns.',
        inputSchema: {
          type: 'object',
          properties: {
            industry_keywords: {
              type: 'string',
              description: 'Keywords defining the industry (e.g., "fitness supplements", "SaaS project management")',
            },
            country: {
              type: 'string',
              description: 'Country code (e.g., "US"). Default: US',
            },
            limit: {
              type: 'integer',
              description: 'Number of ads to analyze (1-100). Default: 50',
            },
          },
          required: ['industry_keywords'],
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
      case 'search_ads': {
        const { search_terms, country, status, limit } = args;
        result = await searchAds(search_terms, { country, status, limit });
        break;
      }

      case 'get_advertiser_ads': {
        const { advertiser_name, status, country, limit } = args;
        result = await getAdvertiserAds(advertiser_name, { status, country, limit });
        break;
      }

      case 'analyze_ad_longevity': {
        const { advertiser_name, min_days_active, country } = args;
        result = await analyzeAdLongevity(advertiser_name, min_days_active, country);
        break;
      }

      case 'get_trending_creatives': {
        const { industry_keywords, country, limit } = args;
        result = await getTrendingCreatives(industry_keywords, country, limit);
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
  console.error('Meta Ad Library MCP server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
