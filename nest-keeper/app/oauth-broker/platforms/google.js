import axios from 'axios';

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email'
];

export default {
  name: 'google',

  /**
   * Build OAuth authorization URL
   * @param {string} clientId - Client VM identifier
   * @param {string} state - Encrypted state parameter
   * @param {object} config - Platform configuration
   * @returns {string} OAuth authorization URL
   */
  getAuthUrl(clientId, state, config) {
    const { GOOGLE_CLIENT_ID, OAUTH_REDIRECT_URI } = config;

    if (!GOOGLE_CLIENT_ID || !OAUTH_REDIRECT_URI) {
      throw new Error('Google platform missing required config: GOOGLE_CLIENT_ID, OAUTH_REDIRECT_URI');
    }

    const scopes = GOOGLE_SCOPES.join(' ');

    const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${GOOGLE_CLIENT_ID}&` +
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
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OAUTH_REDIRECT_URI } = config;

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !OAUTH_REDIRECT_URI) {
      throw new Error('Google platform missing required config');
    }

    console.log('[Google] Exchanging code for access token...');

    // Exchange code for access token and refresh token
    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: OAUTH_REDIRECT_URI,
      grant_type: 'authorization_code'
    });

    const accessToken = tokenResponse.data.access_token;
    const refreshToken = tokenResponse.data.refresh_token;
    const expiresIn = tokenResponse.data.expires_in; // seconds (typically 3600 = 1 hour)

    if (!refreshToken) {
      console.warn('[Google] No refresh token received. User may have already authorized this app.');
    }

    // Get user info
    console.log('[Google] Fetching user info...');
    const userInfoResponse = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    const email = userInfoResponse.data.email;
    const userId = userInfoResponse.data.id;

    // Get Drive info (optional - may need additional permissions)
    let driveId = null;
    try {
      console.log('[Google] Fetching Drive info...');
      const driveResponse = await axios.get('https://www.googleapis.com/drive/v3/about?fields=user', {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
      driveId = driveResponse.data.user?.permissionId || null;
    } catch (err) {
      console.warn('[Google] Could not fetch Drive info:', err.message);
    }

    // Return standardized credential payload
    return {
      platform: 'google',
      access_token: accessToken,
      refresh_token: refreshToken,
      token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      scopes: GOOGLE_SCOPES,
      platform_data: {
        email: email,
        user_id: userId,
        drive_id: driveId
      }
    };
  }
};
