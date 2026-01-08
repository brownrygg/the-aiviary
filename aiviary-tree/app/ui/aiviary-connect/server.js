import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Pool } = pg;

const app = express();
const PORT = process.env.PORT || 3006;

// Middleware
app.use(cors());
app.use(express.json());

// Configuration
const VM_API_KEY = process.env.VM_API_KEY;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

// PostgreSQL Pool
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'postgres',
  port: process.env.POSTGRES_PORT || 5432,
  database: process.env.POSTGRES_DB || 'n8n',
  user: process.env.POSTGRES_USER || 'postgres-non-root',
  password: process.env.POSTGRES_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('[PostgreSQL] Unexpected pool error', err.message);
});

if (!VM_API_KEY) {
  console.error('ERROR: VM_API_KEY is required');
  process.exit(1);
}

if (!ENCRYPTION_KEY) {
  console.error('ERROR: ENCRYPTION_KEY is required');
  process.exit(1);
}

// ============================================================================
// ENCRYPTION UTILITIES
// ============================================================================

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
  const parts = text.split(':');
  const iv = Buffer.from(parts.shift(), 'hex');
  const encryptedText = Buffer.from(parts.join(':'), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

// ============================================================================
// DATABASE HELPERS
// ============================================================================

async function storeCredentials(credentials) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check if credentials exist for this platform
    const checkResult = await client.query(
      'SELECT id FROM oauth_credentials WHERE client_id = $1 AND platform = $2',
      [credentials.client_id, credentials.platform]
    );

    const encryptedAccessToken = encrypt(credentials.access_token);
    const encryptedRefreshToken = credentials.refresh_token ? encrypt(credentials.refresh_token) : null;
    const isNew = checkResult.rows.length === 0;

    if (isNew) {
      // Insert new credentials
      await client.query(
        `INSERT INTO oauth_credentials (
          client_id, platform, access_token, refresh_token, token_expires_at,
          scopes, platform_metadata, last_refreshed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          credentials.client_id,
          credentials.platform,
          encryptedAccessToken,
          encryptedRefreshToken,
          credentials.token_expires_at || null,
          credentials.scopes || [],
          JSON.stringify(credentials.platform_data || {})
        ]
      );

      // Create backfill job ONLY for Meta platform
      if (credentials.platform === 'meta' && credentials.platform_data?.instagram_business_account_id) {
        await client.query(
          `INSERT INTO sync_jobs (client_id, job_type, priority, job_payload)
           VALUES ($1, 'backfill', 100, $2)`,
          [
            credentials.client_id,
            JSON.stringify({
              instagram_account_id: credentials.platform_data.instagram_business_account_id,
              ad_account_id: credentials.platform_data.ad_account_id
            })
          ]
        );
        console.log(`[PostgreSQL] Created backfill job for Meta platform`);
      }

      console.log(`[PostgreSQL] Created new ${credentials.platform} credentials for: ${credentials.client_id}`);
    } else {
      // Update existing credentials
      await client.query(
        `UPDATE oauth_credentials SET
          access_token = $1,
          refresh_token = $2,
          token_expires_at = $3,
          scopes = $4,
          platform_metadata = $5,
          last_refreshed_at = NOW(),
          updated_at = NOW()
         WHERE client_id = $6 AND platform = $7`,
        [
          encryptedAccessToken,
          encryptedRefreshToken,
          credentials.token_expires_at || null,
          credentials.scopes || [],
          JSON.stringify(credentials.platform_data || {}),
          credentials.client_id,
          credentials.platform
        ]
      );

      console.log(`[PostgreSQL] Updated existing ${credentials.platform} credentials for: ${credentials.client_id}`);
    }

    await client.query('COMMIT');
    return isNew ? 'created' : 'updated';

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ============================================================================
// ROUTES
// ============================================================================

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'credential-receiver',
    database: 'postgresql'
  });
});

// ============================================================================
// RECEIVE CREDENTIALS FROM CENTRAL OAUTH BROKER
// ============================================================================
app.post('/api/credentials', async (req, res) => {
  // Verify API key
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== VM_API_KEY) {
    console.warn('[Security] Invalid API key attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const credentials = req.body;

  // Log the original client_id from broker (for routing audit)
  const brokerClientId = credentials.client_id;
  console.log(`[Credentials Received] Platform: ${credentials.platform}, Broker client_id: ${brokerClientId}`);

  // Override client_id with generic 'client' for single-tenant VM storage
  const CLIENT_ID = process.env.CLIENT_ID || 'client';
  credentials.client_id = CLIENT_ID;

  // Validate required fields for standardized payload
  const required = ['platform', 'access_token', 'platform_data'];

  for (const field of required) {
    if (!credentials[field]) {
      return res.status(400).json({ error: `Missing required field: ${field}` });
    }
  }

  // Validate platform is a supported value
  const supportedPlatforms = ['meta', 'asana', 'google', 'monday', 'slack', 'linkedin', 'tiktok', 'youtube'];
  if (!supportedPlatforms.includes(credentials.platform)) {
    return res.status(400).json({
      error: `Unsupported platform: ${credentials.platform}`,
      supported: supportedPlatforms
    });
  }

  console.log(`[Storage] Storing ${credentials.platform} credentials as client_id: '${credentials.client_id}'`);
  console.log(`  Scopes: ${credentials.scopes?.join(', ') || 'N/A'}`);
  console.log(`  Token Expires: ${credentials.token_expires_at || 'Never'}`);
  console.log(`  Has Refresh Token: ${credentials.refresh_token ? 'Yes' : 'No'}`);
  console.log(`  Platform Data: ${JSON.stringify(credentials.platform_data)}`);

  try {
    const result = await storeCredentials(credentials);

    res.status(200).json({
      success: true,
      message: `${credentials.platform} credentials received and stored`,
      broker_client_id: brokerClientId,
      storage_client_id: credentials.client_id,
      platform: credentials.platform,
      platform_data: credentials.platform_data,
      action: result,
      backfill_triggered: result === 'created' && credentials.platform === 'meta'
    });

  } catch (err) {
    console.error(`[Error storing ${credentials.platform} credentials]`, err.message);
    console.error(err.stack);
    res.status(500).json({
      error: 'Failed to store credentials',
      platform: credentials.platform,
      details: err.message
    });
  }
});

// ============================================================================
// GET CREDENTIALS METADATA (for n8n workflows - NO TOKEN)
// ============================================================================
app.get('/api/credentials', async (req, res) => {
  const platform = req.query.platform;

  if (!platform) {
    return res.status(400).json({
      error: 'Missing required query parameter: platform',
      usage: '/api/credentials?platform=meta'
    });
  }

  try {
    const CLIENT_ID = process.env.CLIENT_ID || 'client';
    const result = await pool.query(
      `SELECT client_id, platform, scopes, platform_metadata,
              token_expires_at, last_refreshed_at, created_at
       FROM oauth_credentials
       WHERE client_id = $1 AND platform = $2
       LIMIT 1`,
      [CLIENT_ID, platform]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: `No ${platform} credentials found`,
        client_id: CLIENT_ID
      });
    }

    const creds = result.rows[0];

    res.json({
      client_id: creds.client_id,
      platform: creds.platform,
      scopes: creds.scopes,
      platform_metadata: creds.platform_metadata,
      token_expires_at: creds.token_expires_at,
      last_refreshed_at: creds.last_refreshed_at,
      created_at: creds.created_at
    });

  } catch (err) {
    console.error('[Error fetching credentials]', err.message);
    res.status(500).json({ error: 'Failed to fetch credentials' });
  }
});

// ============================================================================
// GET CREDENTIALS WITH TOKEN (for MCP servers ONLY)
// ============================================================================
app.get('/api/credentials/token', async (req, res) => {
  const platform = req.query.platform;

  if (!platform) {
    return res.status(400).json({
      error: 'Missing required query parameter: platform',
      usage: '/api/credentials/token?platform=meta'
    });
  }

  try {
    const CLIENT_ID = process.env.CLIENT_ID || 'client';
    const result = await pool.query(
      `SELECT client_id, platform, access_token, refresh_token,
              token_expires_at, scopes, platform_metadata, last_refreshed_at
       FROM oauth_credentials
       WHERE client_id = $1 AND platform = $2
       LIMIT 1`,
      [CLIENT_ID, platform]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: `No ${platform} credentials found`,
        client_id: CLIENT_ID
      });
    }

    const creds = result.rows[0];

    // Decrypt the access token
    let accessToken;
    try {
      accessToken = decrypt(creds.access_token);
    } catch (err) {
      console.error('[Decryption Error]', err.message);
      return res.status(500).json({ error: 'Failed to decrypt access token' });
    }

    // Decrypt refresh token if present
    let refreshToken = null;
    if (creds.refresh_token) {
      try {
        refreshToken = decrypt(creds.refresh_token);
      } catch (err) {
        console.error('[Decryption Error - Refresh Token]', err.message);
        // Continue without refresh token rather than failing
      }
    }

    // Check if token is expired (only if expiry is set)
    let isExpired = false;
    if (creds.token_expires_at) {
      const expiresAt = new Date(creds.token_expires_at);
      const now = new Date();
      isExpired = expiresAt < now;

      if (isExpired) {
        console.warn(`[Token Expired] ${platform} token expired at`, expiresAt.toISOString());
      }
    }

    // Return full credentials including decrypted tokens
    res.json({
      client_id: creds.client_id,
      platform: creds.platform,
      access_token: accessToken,
      refresh_token: refreshToken,
      token_expires_at: creds.token_expires_at,
      token_expired: isExpired,
      scopes: creds.scopes,
      platform_metadata: creds.platform_metadata,
      last_refreshed_at: creds.last_refreshed_at
    });

    console.log(`[Token Access] Provided decrypted ${platform} token for client: ${creds.client_id}`);

  } catch (err) {
    console.error('[Error fetching credentials with token]', err.message);
    res.status(500).json({ error: 'Failed to fetch credentials' });
  }
});

// ============================================================================
// GET CONNECTION STATUS FOR ALL PLATFORMS
// ============================================================================
app.get('/api/credentials/status', async (req, res) => {
  try {
    const CLIENT_ID = process.env.CLIENT_ID || 'client';

    // Query all connected platforms for this client
    const result = await pool.query(
      `SELECT platform FROM oauth_credentials WHERE client_id = $1`,
      [CLIENT_ID]
    );

    // Create status object for all supported platforms
    const supportedPlatforms = ['meta', 'asana', 'google', 'monday', 'slack', 'linkedin', 'tiktok', 'youtube'];
    const connectedPlatforms = result.rows.map(row => row.platform);

    const status = {};
    for (const platform of supportedPlatforms) {
      status[platform] = connectedPlatforms.includes(platform);
    }

    res.json({
      client_id: CLIENT_ID,
      platforms: status,
      connected_count: connectedPlatforms.length,
      total_supported: supportedPlatforms.length
    });

  } catch (err) {
    console.error('[Error fetching connection status]', err.message);
    res.status(500).json({ error: 'Failed to fetch connection status' });
  }
});

// ============================================================================
// GET SYNC STATUS FOR BACKFILL PROGRESS
// ============================================================================
app.get('/api/sync-status', async (req, res) => {
  try {
    const CLIENT_ID = process.env.CLIENT_ID || 'client';

    // Check sync_status table for backfill progress
    const statusResult = await pool.query(
      `SELECT backfill_started_at, backfill_completed, backfill_completed_at, backfill_error
       FROM sync_status WHERE client_id = $1 LIMIT 1`,
      [CLIENT_ID]
    );

    if (statusResult.rows.length === 0) {
      // Check sync_jobs for pending backfill
      const jobResult = await pool.query(
        `SELECT id, status, created_at FROM sync_jobs
         WHERE client_id = $1 AND job_type = 'backfill'
         ORDER BY created_at DESC LIMIT 1`,
        [CLIENT_ID]
      );

      if (jobResult.rows.length > 0) {
        const job = jobResult.rows[0];
        return res.json({
          syncing: job.status === 'pending' || job.status === 'processing',
          started_at: null,
          completed: false,
          status: job.status === 'pending' ? 'queued' : 'processing'
        });
      }

      return res.json({
        syncing: false,
        started_at: null,
        completed: false,
        status: 'no_sync'
      });
    }

    const sync = statusResult.rows[0];
    res.json({
      syncing: sync.backfill_started_at && !sync.backfill_completed,
      started_at: sync.backfill_started_at,
      completed: sync.backfill_completed || false,
      completed_at: sync.backfill_completed_at,
      error: sync.backfill_error,
      status: sync.backfill_completed ? 'completed' : sync.backfill_started_at ? 'syncing' : 'pending'
    });

  } catch (err) {
    console.error('[Error fetching sync status]', err.message);
    res.status(500).json({ error: 'Failed to fetch sync status' });
  }
});

// ============================================================================
// ONBOARDING SUCCESS PAGE (with auto-redirect)
// ============================================================================
app.get('/onboard/success', (req, res) => {
  const host = req.get('host') || 'localhost';
  const baseUrl = `https://${host}`;

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Connection Successful!</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Lora:wght@500;600&display=swap" rel="stylesheet">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Inter', -apple-system, sans-serif;
          background: linear-gradient(180deg, #C2E0FF 0%, #F7F5F0 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .container {
          background: rgba(255, 255, 255, 0.85);
          backdrop-filter: blur(16px);
          border-radius: 20px;
          padding: 60px 40px;
          max-width: 500px;
          text-align: center;
          box-shadow: 0 20px 60px rgba(44, 74, 82, 0.15);
          border: 1px solid rgba(255, 255, 255, 0.9);
        }
        .success-icon { font-size: 80px; margin-bottom: 20px; animation: bounce 1s ease; }
        @keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-20px); } }
        h1 {
          font-family: 'Lora', serif;
          color: #2C4A52;
          font-size: 32px;
          margin-bottom: 20px;
          font-weight: 600;
        }
        p { color: #6B7C85; font-size: 18px; line-height: 1.6; margin-bottom: 15px; }
        .status { font-size: 14px; color: #6B7C85; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="success-icon">🎉</div>
        <h1>Connected!</h1>
        <p>Your platform is now connected. Redirecting...</p>
        <p class="status">Starting data sync...</p>
      </div>
      <script>
        setTimeout(() => { window.location.href = '${baseUrl}/connect?connected=true'; }, 2000);
      </script>
    </body>
    </html>
  `);
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, () => {
  console.log(`🔐 Credential Receiver running on port ${PORT}`);
  console.log(`🔑 VM API Key configured: ${!!VM_API_KEY}`);
  console.log(`🔐 Encryption configured: ${!!ENCRYPTION_KEY}`);
  console.log(`💾 Database: PostgreSQL (direct connection)`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  pool.end();
  process.exit(0);
});
