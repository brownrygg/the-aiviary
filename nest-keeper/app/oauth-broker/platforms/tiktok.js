import axios from 'axios';

const TIKTOK_SCOPES = [
  'user.info.basic',
  'video.list',
  'video.publish'
];

export default {
  name: 'tiktok',

  /**
   * Build OAuth authorization URL
   * @param {string} clientId - Client VM identifier
   * @param {string} state - Encrypted state parameter
   * @param {object} config - Platform configuration
   * @returns {string} OAuth authorization URL
   */
  getAuthUrl(clientId, state, config) {
    const { TIKTOK_CLIENT_KEY, OAUTH_REDIRECT_URI } = config;

    if (!TIKTOK_CLIENT_KEY || !OAUTH_REDIRECT_URI) {
      throw new Error('TikTok platform missing required config: TIKTOK_CLIENT_KEY, OAUTH_REDIRECT_URI');
    }

    const scopes = TIKTOK_SCOPES.join(',');

    const oauthUrl = `https://www.tiktok.com/v2/auth/authorize?` +
      `client_key=${TIKTOK_CLIENT_KEY}&` +
      `redirect_uri=${encodeURIComponent(OAUTH_REDIRECT_URI)}&` +
      `response_type=code&` +
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
    const { TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, OAUTH_REDIRECT_URI } = config;

    if (!TIKTOK_CLIENT_KEY || !TIKTOK_CLIENT_SECRET || !OAUTH_REDIRECT_URI) {
      throw new Error('TikTok platform missing required config');
    }

    console.log('[TikTok] Exchanging code for access token...');

    // Exchange code for access token
    const tokenResponse = await axios.post('https://open.tiktokapis.com/v2/oauth/token/',
      new URLSearchParams({
        client_key: TIKTOK_CLIENT_KEY,
        client_secret: TIKTOK_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: OAUTH_REDIRECT_URI
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const data = tokenResponse.data.data;
    const accessToken = data.access_token;
    const refreshToken = data.refresh_token;
    const expiresIn = data.expires_in; // seconds
    const openId = data.open_id;

    // Get user info
    console.log('[TikTok] Fetching user info...');
    let displayName = null;
    let username = null;
    try {
      const userInfoResponse = await axios.post('https://open.tiktokapis.com/v2/user/info/',
        {
          fields: ['open_id', 'display_name', 'username']
        },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (userInfoResponse.data.data && userInfoResponse.data.data.user) {
        displayName = userInfoResponse.data.data.user.display_name;
        username = userInfoResponse.data.data.user.username;
      }
    } catch (err) {
      console.warn('[TikTok] Could not fetch user info:', err.message);
    }

    // Return standardized credential payload
    return {
      platform: 'tiktok',
      access_token: accessToken,
      refresh_token: refreshToken,
      token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      scopes: TIKTOK_SCOPES,
      platform_data: {
        open_id: openId,
        display_name: displayName,
        username: username
      }
    };
  }
};
