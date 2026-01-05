const axios = require('axios');
const logger = require('./logger');

const CREDENTIAL_RECEIVER_URL = process.env.CREDENTIAL_RECEIVER_URL || 'http://credential-receiver:3006';

/**
 * Fetch OAuth credentials from credential-receiver
 * Returns decrypted access token and account IDs
 * Platform defaults to 'meta' for backwards compatibility
 */
async function getCredentials(clientId = null, platform = 'meta') {
  try {
    const url = `${CREDENTIAL_RECEIVER_URL}/api/credentials/token?platform=${platform}`;
    const params = clientId ? { client_id: clientId } : {};

    const response = await axios.get(url, { params });

    if (!response.data) {
      throw new Error('No credentials data returned');
    }

    const credentials = response.data;

    // Validate required fields
    if (!credentials.access_token) {
      throw new Error('No access token in credentials');
    }

    // Check token expiry (only if expiry is set)
    if (credentials.token_expired) {
      logger.warn('Access token is expired', {
        clientId: credentials.client_id,
        platform: credentials.platform,
        expiresAt: credentials.token_expires_at,
      });
    }

    logger.debug('Credentials fetched successfully', {
      clientId: credentials.client_id,
      platform: credentials.platform,
      hasInstagramAccount: !!credentials.platform_metadata?.instagram_business_account_id,
      hasAdAccount: !!credentials.platform_metadata?.ad_account_id,
      tokenExpired: credentials.token_expired,
    });

    return credentials;
  } catch (error) {
    const errorMessage = error.response?.data?.error || error.message;
    logger.error('Failed to fetch credentials', {
      error: errorMessage,
      clientId,
      platform,
      url: CREDENTIAL_RECEIVER_URL,
    });
    throw new Error(`Credentials fetch failed: ${errorMessage}`);
  }
}

/**
 * Fetch credentials for a specific client
 */
async function getClientCredentials(clientId) {
  if (!clientId) {
    throw new Error('Client ID is required');
  }

  return await getCredentials(clientId);
}

/**
 * Check if credentials exist and are valid
 */
async function hasValidCredentials(clientId) {
  try {
    const credentials = await getClientCredentials(clientId);
    return credentials && credentials.access_token && !credentials.token_expired;
  } catch (error) {
    logger.warn('Credential validation failed', {
      clientId,
      error: error.message,
    });
    return false;
  }
}

/**
 * Get all available account IDs from credentials
 * NOTE: This only works for Meta platform credentials
 */
async function getAccountIds(clientId) {
  const credentials = await getClientCredentials(clientId);

  // Access account IDs from platform_metadata
  return {
    instagram_business_account_id: credentials.platform_metadata?.instagram_business_account_id || null,
    facebook_page_id: credentials.platform_metadata?.facebook_page_id || null,
    ad_account_id: credentials.platform_metadata?.ad_account_id || null,
  };
}

module.exports = {
  getCredentials,
  getClientCredentials,
  hasValidCredentials,
  getAccountIds,
};
