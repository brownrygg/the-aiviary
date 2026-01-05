import axios from 'axios';

const META_SCOPES = [
  'instagram_basic',
  'instagram_manage_insights',
  'instagram_content_publish',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_metadata',
  'ads_read',
  'ads_management',
  'business_management'
];

export default {
  name: 'meta',

  /**
   * Build OAuth authorization URL
   * @param {string} clientId - Client VM identifier
   * @param {string} state - Encrypted state parameter
   * @param {object} config - Platform configuration
   * @returns {string} OAuth authorization URL
   */
  getAuthUrl(clientId, state, config) {
    const { META_APP_ID, OAUTH_REDIRECT_URI } = config;

    if (!META_APP_ID || !OAUTH_REDIRECT_URI) {
      throw new Error('Meta platform missing required config: META_APP_ID, OAUTH_REDIRECT_URI');
    }

    const scopes = META_SCOPES.join(',');

    const oauthUrl = `https://www.facebook.com/v18.0/dialog/oauth?` +
      `client_id=${META_APP_ID}&` +
      `redirect_uri=${encodeURIComponent(OAUTH_REDIRECT_URI)}&` +
      `scope=${scopes}&` +
      `state=${encodeURIComponent(state)}&` +
      `response_type=code`;

    return oauthUrl;
  },

  /**
   * Handle OAuth callback and exchange code for tokens
   * @param {string} code - Authorization code from OAuth callback
   * @param {object} config - Platform configuration
   * @returns {object} Standardized credential payload
   */
  async handleCallback(code, config) {
    const { META_APP_ID, META_APP_SECRET, OAUTH_REDIRECT_URI } = config;

    if (!META_APP_ID || !META_APP_SECRET || !OAUTH_REDIRECT_URI) {
      throw new Error('Meta platform missing required config');
    }

    console.log('[Meta] Exchanging code for access token...');

    // Exchange code for short-lived token
    const tokenResponse = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
      params: {
        client_id: META_APP_ID,
        client_secret: META_APP_SECRET,
        redirect_uri: OAUTH_REDIRECT_URI,
        code
      }
    });

    const shortLivedToken = tokenResponse.data.access_token;

    // Exchange for long-lived token (60 days)
    console.log('[Meta] Exchanging for long-lived token...');
    const longLivedResponse = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: META_APP_ID,
        client_secret: META_APP_SECRET,
        fb_exchange_token: shortLivedToken
      }
    });

    const accessToken = longLivedResponse.data.access_token;
    const expiresIn = longLivedResponse.data.expires_in; // seconds

    // Check granted permissions
    console.log('[Meta] Checking granted permissions...');
    try {
      const permissionsResponse = await axios.get('https://graph.facebook.com/v18.0/me/permissions', {
        params: { access_token: accessToken }
      });
      const grantedPermissions = permissionsResponse.data.data
        .filter(p => p.status === 'granted')
        .map(p => p.permission);
      console.log('[Meta] Granted permissions:', grantedPermissions.join(', '));
    } catch (err) {
      console.warn('[Meta] Could not fetch permissions:', err.message);
    }

    // Get Meta user ID
    const meResponse = await axios.get('https://graph.facebook.com/v18.0/me', {
      params: { access_token: accessToken }
    });
    const metaUserId = meResponse.data.id;

    // Get Facebook pages (which have Instagram accounts)
    console.log('[Meta] Fetching Facebook pages...');
    const pagesResponse = await axios.get('https://graph.facebook.com/v18.0/me/accounts', {
      params: {
        access_token: accessToken,
        fields: 'id,name,instagram_business_account'
      }
    });

    const pages = pagesResponse.data.data || [];
    console.log(`[Meta] Found ${pages.length} Facebook pages`);
    const pageWithInstagram = pages.find(p => p.instagram_business_account);

    if (!pageWithInstagram) {
      throw new Error('No Instagram Business account found. Please connect Instagram to a Facebook Page.');
    }

    const facebookPageId = pageWithInstagram.id;
    const instagramBusinessAccountId = pageWithInstagram.instagram_business_account.id;

    // Get ad accounts
    console.log('[Meta] Fetching ad accounts...');
    let adAccountId = null;
    try {
      const adAccountsResponse = await axios.get('https://graph.facebook.com/v18.0/me/adaccounts', {
        params: {
          access_token: accessToken,
          fields: 'id,name,account_status'
        }
      });
      const adAccounts = adAccountsResponse.data.data || [];
      if (adAccounts.length > 0) {
        adAccountId = adAccounts[0].id;
      }
    } catch (err) {
      console.warn('[Meta] Could not fetch ad accounts:', err.message);
    }

    // Check Ad Library API access (requires Identity Verification)
    console.log('[Meta] Checking Ad Library API access...');
    let adLibraryVerified = false;
    try {
      await axios.get('https://graph.facebook.com/v21.0/ads_archive', {
        params: {
          access_token: accessToken,
          search_terms: 'test',
          ad_reached_countries: "['US']",
          limit: 1
        }
      });
      adLibraryVerified = true;
      console.log('[Meta] ✅ Ad Library API access verified');
    } catch (err) {
      const errorCode = err.response?.data?.error?.error_subcode;
      const errorMsg = err.response?.data?.error?.message || '';

      if (errorCode === 2332002 || errorMsg.includes('verify their identity')) {
        console.log('[Meta] ⚠️ Ad Library API access NOT verified - Identity Verification required');
      } else {
        console.log('[Meta] ⚠️ Ad Library API check failed:', errorMsg);
      }
      adLibraryVerified = false;
    }

    // Return standardized credential payload
    return {
      platform: 'meta',
      access_token: accessToken,
      refresh_token: null, // Meta doesn't provide refresh tokens
      token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      scopes: META_SCOPES,
      platform_data: {
        meta_user_id: metaUserId,
        facebook_page_id: facebookPageId,
        instagram_business_account_id: instagramBusinessAccountId,
        ad_account_id: adAccountId,
        ad_library_verified: adLibraryVerified
      }
    };
  }
};
