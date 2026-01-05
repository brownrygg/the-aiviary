import axios from 'axios';

const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/userinfo.email'
];

export default {
  name: 'youtube',

  /**
   * Build OAuth authorization URL
   * @param {string} clientId - Client VM identifier
   * @param {string} state - Encrypted state parameter
   * @param {object} config - Platform configuration
   * @returns {string} OAuth authorization URL
   */
  getAuthUrl(clientId, state, config) {
    const { YOUTUBE_CLIENT_ID, OAUTH_REDIRECT_URI } = config;

    if (!YOUTUBE_CLIENT_ID || !OAUTH_REDIRECT_URI) {
      throw new Error('YouTube platform missing required config: YOUTUBE_CLIENT_ID, OAUTH_REDIRECT_URI');
    }

    const scopes = YOUTUBE_SCOPES.join(' ');

    const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${YOUTUBE_CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(OAUTH_REDIRECT_URI)}&` +
      `response_type=code&` +
      `scope=${encodeURIComponent(scopes)}&` +
      `access_type=offline&` + // Request refresh token
      `prompt=consent&` + // Force consent screen to ensure refresh token
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
    const { YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, OAUTH_REDIRECT_URI } = config;

    if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET || !OAUTH_REDIRECT_URI) {
      throw new Error('YouTube platform missing required config');
    }

    console.log('[YouTube] Exchanging code for access token...');

    // Exchange code for access token and refresh token (uses Google OAuth)
    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: YOUTUBE_CLIENT_ID,
      client_secret: YOUTUBE_CLIENT_SECRET,
      redirect_uri: OAUTH_REDIRECT_URI,
      grant_type: 'authorization_code'
    });

    const accessToken = tokenResponse.data.access_token;
    const refreshToken = tokenResponse.data.refresh_token;
    const expiresIn = tokenResponse.data.expires_in; // seconds (typically 3600 = 1 hour)

    if (!refreshToken) {
      console.warn('[YouTube] No refresh token received. User may have already authorized this app.');
    }

    // Get user info
    console.log('[YouTube] Fetching user info...');
    const userInfoResponse = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    const email = userInfoResponse.data.email;
    const userId = userInfoResponse.data.id;

    // Get YouTube channel info
    console.log('[YouTube] Fetching YouTube channel info...');
    let channelId = null;
    let channelTitle = null;
    try {
      const channelResponse = await axios.get('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      if (channelResponse.data.items && channelResponse.data.items.length > 0) {
        channelId = channelResponse.data.items[0].id;
        channelTitle = channelResponse.data.items[0].snippet.title;
      }
    } catch (err) {
      console.warn('[YouTube] Could not fetch channel info:', err.message);
    }

    // Return standardized credential payload
    return {
      platform: 'youtube',
      access_token: accessToken,
      refresh_token: refreshToken,
      token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      scopes: YOUTUBE_SCOPES,
      platform_data: {
        email: email,
        user_id: userId,
        channel_id: channelId,
        channel_title: channelTitle
      }
    };
  }
};
