import axios from 'axios';

export default {
  name: 'asana',

  /**
   * Build OAuth authorization URL
   * @param {string} clientId - Client VM identifier
   * @param {string} state - Encrypted state parameter
   * @param {object} config - Platform configuration
   * @returns {string} OAuth authorization URL
   */
  getAuthUrl(clientId, state, config) {
    const { ASANA_CLIENT_ID, OAUTH_REDIRECT_URI } = config;

    if (!ASANA_CLIENT_ID || !OAUTH_REDIRECT_URI) {
      throw new Error('Asana platform missing required config: ASANA_CLIENT_ID, OAUTH_REDIRECT_URI');
    }

    const oauthUrl = `https://app.asana.com/-/oauth_authorize?` +
      `client_id=${ASANA_CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(OAUTH_REDIRECT_URI)}&` +
      `response_type=code&` +
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
    const { ASANA_CLIENT_ID, ASANA_CLIENT_SECRET, OAUTH_REDIRECT_URI } = config;

    if (!ASANA_CLIENT_ID || !ASANA_CLIENT_SECRET || !OAUTH_REDIRECT_URI) {
      throw new Error('Asana platform missing required config');
    }

    console.log('[Asana] Exchanging code for access token...');

    // Exchange code for access token
    const tokenResponse = await axios.post('https://app.asana.com/-/oauth_token', {
      grant_type: 'authorization_code',
      client_id: ASANA_CLIENT_ID,
      client_secret: ASANA_CLIENT_SECRET,
      redirect_uri: OAUTH_REDIRECT_URI,
      code
    });

    const accessToken = tokenResponse.data.access_token;
    const refreshToken = tokenResponse.data.refresh_token || null;

    // Get user info
    console.log('[Asana] Fetching user info...');
    const userResponse = await axios.get('https://app.asana.com/api/1.0/users/me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    const userData = userResponse.data.data;
    const userGid = userData.gid;
    const email = userData.email;

    // Get workspaces
    console.log('[Asana] Fetching workspaces...');
    const workspacesResponse = await axios.get('https://app.asana.com/api/1.0/workspaces', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    const workspaces = workspacesResponse.data.data || [];
    console.log(`[Asana] Found ${workspaces.length} workspace(s)`);

    // Use first workspace (or could prompt user to select)
    const workspaceGid = workspaces.length > 0 ? workspaces[0].gid : null;

    // Return standardized credential payload
    return {
      platform: 'asana',
      access_token: accessToken,
      refresh_token: refreshToken,
      token_expires_at: null, // Asana tokens don't expire
      scopes: ['default'],
      platform_data: {
        user_gid: userGid,
        email: email,
        workspace_gid: workspaceGid,
        workspaces: workspaces.map(w => ({ gid: w.gid, name: w.name }))
      }
    };
  }
};
