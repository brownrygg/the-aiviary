import axios from 'axios';

const LINKEDIN_SCOPES = [
  'r_liteprofile',
  'r_emailaddress',
  'w_member_social',
  'r_organization_social'
];

export default {
  name: 'linkedin',

  /**
   * Build OAuth authorization URL
   * @param {string} clientId - Client VM identifier
   * @param {string} state - Encrypted state parameter
   * @param {object} config - Platform configuration
   * @returns {string} OAuth authorization URL
   */
  getAuthUrl(clientId, state, config) {
    const { LINKEDIN_CLIENT_ID, OAUTH_REDIRECT_URI } = config;

    if (!LINKEDIN_CLIENT_ID || !OAUTH_REDIRECT_URI) {
      throw new Error('LinkedIn platform missing required config: LINKEDIN_CLIENT_ID, OAUTH_REDIRECT_URI');
    }

    const scopes = LINKEDIN_SCOPES.join(' ');

    const oauthUrl = `https://www.linkedin.com/oauth/v2/authorization?` +
      `client_id=${LINKEDIN_CLIENT_ID}&` +
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
    const { LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, OAUTH_REDIRECT_URI } = config;

    if (!LINKEDIN_CLIENT_ID || !LINKEDIN_CLIENT_SECRET || !OAUTH_REDIRECT_URI) {
      throw new Error('LinkedIn platform missing required config');
    }

    console.log('[LinkedIn] Exchanging code for access token...');

    // Exchange code for access token
    const tokenResponse = await axios.post('https://www.linkedin.com/oauth/v2/accessToken',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: LINKEDIN_CLIENT_ID,
        client_secret: LINKEDIN_CLIENT_SECRET,
        redirect_uri: OAUTH_REDIRECT_URI
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const accessToken = tokenResponse.data.access_token;
    const expiresIn = tokenResponse.data.expires_in; // seconds (typically 60 days)
    const refreshToken = tokenResponse.data.refresh_token || null;

    // Get user profile
    console.log('[LinkedIn] Fetching user profile...');
    const profileResponse = await axios.get('https://api.linkedin.com/v2/me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    const userId = profileResponse.data.id;
    const firstName = profileResponse.data.localizedFirstName;
    const lastName = profileResponse.data.localizedLastName;

    // Get email
    console.log('[LinkedIn] Fetching email address...');
    let email = null;
    try {
      const emailResponse = await axios.get('https://api.linkedin.com/v2/emailAddress?q=members&projection=(elements*(handle~))', {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      if (emailResponse.data.elements && emailResponse.data.elements.length > 0) {
        email = emailResponse.data.elements[0]['handle~']?.emailAddress;
      }
    } catch (err) {
      console.warn('[LinkedIn] Could not fetch email:', err.message);
    }

    // Return standardized credential payload
    return {
      platform: 'linkedin',
      access_token: accessToken,
      refresh_token: refreshToken,
      token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      scopes: LINKEDIN_SCOPES,
      platform_data: {
        user_id: userId,
        first_name: firstName,
        last_name: lastName,
        email: email
      }
    };
  }
};
