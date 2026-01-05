import axios from 'axios';

const MONDAY_SCOPES = [
  'boards:read',
  'boards:write',
  'workspaces:read',
  'users:read',
  'teams:read'
];

export default {
  name: 'monday',

  /**
   * Build OAuth authorization URL
   * @param {string} clientId - Client VM identifier
   * @param {string} state - Encrypted state parameter
   * @param {object} config - Platform configuration
   * @returns {string} OAuth authorization URL
   */
  getAuthUrl(clientId, state, config) {
    const { MONDAY_CLIENT_ID, OAUTH_REDIRECT_URI } = config;

    if (!MONDAY_CLIENT_ID || !OAUTH_REDIRECT_URI) {
      throw new Error('Monday platform missing required config: MONDAY_CLIENT_ID, OAUTH_REDIRECT_URI');
    }

    const scopes = MONDAY_SCOPES.join(' ');

    const oauthUrl = `https://auth.monday.com/oauth2/authorize?` +
      `client_id=${MONDAY_CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(OAUTH_REDIRECT_URI)}&` +
      `scope=${encodeURIComponent(scopes)}&` +
      `state=${encodeURIComponent(state)}`;

    return oauthUrl;
  },

  /**
   * Handle OAuth callback and exchange code for tokens
   * @param {string} code - Authorization code from OAuth callback
   * @param {object} config - Platform configuration
   * @returns {object} Standardized credential payload
   */
  async handleCallback(code, config) {
    const { MONDAY_CLIENT_ID, MONDAY_CLIENT_SECRET, OAUTH_REDIRECT_URI } = config;

    if (!MONDAY_CLIENT_ID || !MONDAY_CLIENT_SECRET || !OAUTH_REDIRECT_URI) {
      throw new Error('Monday platform missing required config');
    }

    console.log('[Monday] Exchanging code for access token...');

    // Exchange code for access token
    const tokenResponse = await axios.post('https://auth.monday.com/oauth2/token', {
      code,
      client_id: MONDAY_CLIENT_ID,
      client_secret: MONDAY_CLIENT_SECRET,
      redirect_uri: OAUTH_REDIRECT_URI
    });

    const accessToken = tokenResponse.data.access_token;
    const refreshToken = tokenResponse.data.refresh_token || null;

    // Get user info via Monday GraphQL API
    console.log('[Monday] Fetching user info...');
    const userResponse = await axios.post('https://api.monday.com/v2', {
      query: 'query { me { id name email account { id name slug } } }'
    }, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    const userData = userResponse.data.data.me;
    const userId = userData.id;
    const email = userData.email;
    const accountId = userData.account?.id;
    const accountSlug = userData.account?.slug;

    // Return standardized credential payload
    return {
      platform: 'monday',
      access_token: accessToken,
      refresh_token: refreshToken,
      token_expires_at: null, // Monday tokens don't expire
      scopes: MONDAY_SCOPES,
      platform_data: {
        user_id: userId,
        email: email,
        account_id: accountId,
        account_slug: accountSlug
      }
    };
  }
};
