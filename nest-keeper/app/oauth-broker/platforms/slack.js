import axios from 'axios';

const SLACK_SCOPES = [
  'channels:read',
  'channels:history',
  'chat:write',
  'users:read',
  'users:read.email',
  'team:read'
];

export default {
  name: 'slack',

  /**
   * Build OAuth authorization URL
   * @param {string} clientId - Client VM identifier
   * @param {string} state - Encrypted state parameter
   * @param {object} config - Platform configuration
   * @returns {string} OAuth authorization URL
   */
  getAuthUrl(clientId, state, config) {
    const { SLACK_CLIENT_ID, OAUTH_REDIRECT_URI } = config;

    if (!SLACK_CLIENT_ID || !OAUTH_REDIRECT_URI) {
      throw new Error('Slack platform missing required config: SLACK_CLIENT_ID, OAUTH_REDIRECT_URI');
    }

    const scopes = SLACK_SCOPES.join(',');

    const oauthUrl = `https://slack.com/oauth/v2/authorize?` +
      `client_id=${SLACK_CLIENT_ID}&` +
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
    const { SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, OAUTH_REDIRECT_URI } = config;

    if (!SLACK_CLIENT_ID || !SLACK_CLIENT_SECRET || !OAUTH_REDIRECT_URI) {
      throw new Error('Slack platform missing required config');
    }

    console.log('[Slack] Exchanging code for access token...');

    // Exchange code for access token
    const tokenResponse = await axios.post('https://slack.com/api/oauth.v2.access',
      new URLSearchParams({
        code,
        client_id: SLACK_CLIENT_ID,
        client_secret: SLACK_CLIENT_SECRET,
        redirect_uri: OAUTH_REDIRECT_URI
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    if (!tokenResponse.data.ok) {
      throw new Error(`Slack OAuth error: ${tokenResponse.data.error}`);
    }

    const accessToken = tokenResponse.data.access_token;
    const refreshToken = tokenResponse.data.refresh_token || null;
    const expiresIn = tokenResponse.data.expires_in; // seconds (if token rotation enabled)

    const teamId = tokenResponse.data.team?.id;
    const teamName = tokenResponse.data.team?.name;
    const userId = tokenResponse.data.authed_user?.id;

    // Get additional user info
    console.log('[Slack] Fetching user info...');
    let email = null;
    try {
      const userInfoResponse = await axios.get('https://slack.com/api/users.info', {
        params: { user: userId },
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      if (userInfoResponse.data.ok) {
        email = userInfoResponse.data.user?.profile?.email;
      }
    } catch (err) {
      console.warn('[Slack] Could not fetch user email:', err.message);
    }

    // Return standardized credential payload
    return {
      platform: 'slack',
      access_token: accessToken,
      refresh_token: refreshToken,
      token_expires_at: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
      scopes: SLACK_SCOPES,
      platform_data: {
        team_id: teamId,
        team_name: teamName,
        user_id: userId,
        email: email
      }
    };
  }
};
