import express from 'express';
import cors from 'cors';
import pg from 'pg';
import redis from 'redis';
import axios from 'axios';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { getPlatform, listPlatforms, validatePlatforms } from './platforms/index.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database connections
const pgPool = new pg.Pool({
  host: process.env.POSTGRES_HOST || 'postgres',
  port: process.env.POSTGRES_PORT || 5432,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

const redisClient = redis.createClient({
  socket: {
    host: process.env.REDIS_HOST || 'redis',
    port: process.env.REDIS_PORT || 6379
  }
});

// Connect to Redis
redisClient.on('error', (err) => console.error('Redis Client Error', err));
await redisClient.connect();

// Validate platform handlers
validatePlatforms();

// Constants
const META_APP_ID = process.env.META_APP_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;
const ASANA_CLIENT_ID = process.env.ASANA_CLIENT_ID;
const ASANA_CLIENT_SECRET = process.env.ASANA_CLIENT_SECRET;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const MONDAY_CLIENT_ID = process.env.MONDAY_CLIENT_ID;
const MONDAY_CLIENT_SECRET = process.env.MONDAY_CLIENT_SECRET;
const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID;
const SLACK_CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET;
const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
const YOUTUBE_CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const YOUTUBE_CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const OAUTH_REDIRECT_URI = process.env.OAUTH_REDIRECT_URI;
const BASE_URL = process.env.BASE_URL;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

// Platform configuration
const platformConfig = {
  META_APP_ID,
  META_APP_SECRET,
  ASANA_CLIENT_ID,
  ASANA_CLIENT_SECRET,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  MONDAY_CLIENT_ID,
  MONDAY_CLIENT_SECRET,
  SLACK_CLIENT_ID,
  SLACK_CLIENT_SECRET,
  LINKEDIN_CLIENT_ID,
  LINKEDIN_CLIENT_SECRET,
  TIKTOK_CLIENT_KEY,
  TIKTOK_CLIENT_SECRET,
  YOUTUBE_CLIENT_ID,
  YOUTUBE_CLIENT_SECRET,
  OAUTH_REDIRECT_URI,
  BASE_URL
};

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

async function getClientVM(clientId) {
  const result = await pgPool.query(
    'SELECT * FROM client_vm_registry WHERE client_id = $1 AND status = $2',
    [clientId, 'active']
  );
  return result.rows[0] || null;
}

async function logOAuthEvent(event) {
  try {
    await pgPool.query(
      `INSERT INTO oauth_events (
        client_id, event_type, state_param, auth_code, error_message,
        meta_user_id, instagram_business_account_id, ad_account_id,
        vm_url, forwarding_status, forwarding_response, platform, platform_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        event.client_id || null,
        event.event_type,
        event.state_param || null,
        event.auth_code || null,
        event.error_message || null,
        event.meta_user_id || null,
        event.instagram_business_account_id || null,
        event.ad_account_id || null,
        event.vm_url || null,
        event.forwarding_status || null,
        event.forwarding_response || null,
        event.platform || null,
        event.platform_data ? JSON.stringify(event.platform_data) : null
      ]
    );
  } catch (err) {
    console.error('Error logging OAuth event:', err);
  }
}

// ============================================================================
// ROUTES
// ============================================================================

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'meta-oauth-broker' });
});

// ============================================================================
// OAUTH FLOW: Step 1 - Initiate OAuth
// ============================================================================
app.get('/auth/:platform', async (req, res) => {
  const { platform } = req.params;
  const { client_id, return_url } = req.query;

  if (!client_id) {
    return res.status(400).json({ error: 'client_id is required' });
  }

  try {
    // Get platform handler
    const platformHandler = getPlatform(platform);

    // Verify client exists
    const client = await getClientVM(client_id);
    if (!client) {
      return res.status(404).json({ error: 'Client not found or inactive' });
    }

    // Create state param (encrypted)
    const state = encrypt(JSON.stringify({
      client_id,
      platform,
      return_url: return_url || client.vm_url + '/onboard/success',
      timestamp: Date.now()
    }));

    // Log event
    await logOAuthEvent({
      client_id,
      platform,
      event_type: 'oauth_initiated',
      state_param: state,
      vm_url: client.vm_url
    });

    // Get OAuth URL from platform handler
    const oauthUrl = platformHandler.getAuthUrl(client_id, state, platformConfig);

    console.log(`[OAuth Initiated] Client: ${client_id}, Platform: ${platform}`);
    res.redirect(oauthUrl);

  } catch (err) {
    console.error(`[OAuth Error] Platform: ${platform}, Error: ${err.message}`);
    return res.status(400).json({ error: err.message });
  }
});

// ============================================================================
// OAUTH FLOW: Step 2 - Handle Callback
// ============================================================================
app.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  // Handle OAuth errors
  if (error) {
    console.error('[OAuth Error]', error, error_description);
    await logOAuthEvent({
      event_type: 'oauth_error',
      state_param: state,
      error_message: `${error}: ${error_description}`
    });
    return res.status(400).send(`OAuth Error: ${error_description || error}`);
  }

  if (!code || !state) {
    return res.status(400).send('Missing code or state parameter');
  }

  try {
    // Decrypt state
    const stateData = JSON.parse(decrypt(state));
    const { client_id, platform, return_url } = stateData;

    console.log(`[OAuth Callback] Client: ${client_id}, Platform: ${platform}`);

    // Get client VM details
    const client = await getClientVM(client_id);
    if (!client) {
      throw new Error('Client not found or inactive');
    }

    // Get platform handler
    const platformHandler = getPlatform(platform);

    // Handle OAuth callback via platform handler
    const platformCredentials = await platformHandler.handleCallback(code, platformConfig);

    // Add client_id to standardized payload
    const credentials = {
      client_id,
      ...platformCredentials
    };

    // Forward credentials to client VM
    console.log(`[OAuth] Forwarding credentials to VM: ${client.vm_url}`);
    const vmResponse = await axios.post(
      `${client.vm_url}/api/credentials`,
      credentials,
      {
        headers: {
          'X-API-Key': client.vm_api_key,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    console.log('[OAuth] Credentials successfully forwarded to VM');

    // Log successful event
    await logOAuthEvent({
      client_id,
      platform,
      event_type: 'oauth_success',
      state_param: state,
      auth_code: code,
      meta_user_id: platformCredentials.platform_data?.meta_user_id || null,
      instagram_business_account_id: platformCredentials.platform_data?.instagram_business_account_id || null,
      ad_account_id: platformCredentials.platform_data?.ad_account_id || null,
      vm_url: client.vm_url,
      forwarding_status: 'success',
      forwarding_response: JSON.stringify(vmResponse.data),
      platform_data: platformCredentials.platform_data
    });

    // Update last OAuth timestamp
    await pgPool.query(
      'UPDATE client_vm_registry SET last_oauth_at = NOW() WHERE client_id = $1',
      [client_id]
    );

    // Redirect back to client VM
    res.redirect(return_url || `${client.vm_url}/onboard/success`);

  } catch (err) {
    console.error('[OAuth Callback Error]', err.message);

    // Try to extract client_id and platform from state
    let clientId = null;
    let platform = null;
    try {
      const stateData = JSON.parse(decrypt(state));
      clientId = stateData.client_id;
      platform = stateData.platform;
    } catch {}

    await logOAuthEvent({
      client_id: clientId,
      platform: platform,
      event_type: 'oauth_callback_error',
      state_param: state,
      error_message: err.message,
      forwarding_status: 'failed'
    });

    res.status(500).send(`OAuth Error: ${err.message}`);
  }
});

// ============================================================================
// ADMIN API: Manage Client-VM Registry
// ============================================================================

// List all registered clients
app.get('/admin/clients', async (req, res) => {
  try {
    const result = await pgPool.query(
      'SELECT id, client_id, client_name, vm_url, status, created_at, last_oauth_at FROM client_vm_registry ORDER BY created_at DESC'
    );
    res.json({ clients: result.rows });
  } catch (err) {
    console.error('Error fetching clients:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Register a new client
app.post('/admin/clients', async (req, res) => {
  const { client_id, client_name, vm_url, vm_api_key } = req.body;

  if (!client_id || !client_name || !vm_url || !vm_api_key) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const result = await pgPool.query(
      `INSERT INTO client_vm_registry (client_id, client_name, vm_url, vm_api_key, status)
       VALUES ($1, $2, $3, $4, 'active')
       RETURNING id, client_id, client_name, vm_url, status, created_at`,
      [client_id, client_name, vm_url, vm_api_key]
    );

    console.log(`[Admin] Registered new client: ${client_id}`);
    res.status(201).json({ client: result.rows[0] });
  } catch (err) {
    console.error('Error registering client:', err);
    if (err.code === '23505') { // Unique violation
      res.status(409).json({ error: 'Client ID or VM URL already exists' });
    } else {
      res.status(500).json({ error: 'Database error' });
    }
  }
});

// Update client
app.put('/admin/clients/:client_id', async (req, res) => {
  const { client_id } = req.params;
  const { client_name, vm_url, vm_api_key, status } = req.body;

  try {
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (client_name) {
      updates.push(`client_name = $${paramIndex++}`);
      values.push(client_name);
    }
    if (vm_url) {
      updates.push(`vm_url = $${paramIndex++}`);
      values.push(vm_url);
    }
    if (vm_api_key) {
      updates.push(`vm_api_key = $${paramIndex++}`);
      values.push(vm_api_key);
    }
    if (status) {
      updates.push(`status = $${paramIndex++}`);
      values.push(status);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(client_id);
    const result = await pgPool.query(
      `UPDATE client_vm_registry SET ${updates.join(', ')} WHERE client_id = $${paramIndex} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    console.log(`[Admin] Updated client: ${client_id}`);
    res.json({ client: result.rows[0] });
  } catch (err) {
    console.error('Error updating client:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Delete client
app.delete('/admin/clients/:client_id', async (req, res) => {
  const { client_id } = req.params;

  try {
    const result = await pgPool.query(
      'DELETE FROM client_vm_registry WHERE client_id = $1 RETURNING *',
      [client_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    console.log(`[Admin] Deleted client: ${client_id}`);
    res.json({ message: 'Client deleted', client: result.rows[0] });
  } catch (err) {
    console.error('Error deleting client:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// View OAuth event logs
app.get('/admin/events', async (req, res) => {
  const { client_id, limit = 100 } = req.query;

  try {
    let query = 'SELECT * FROM oauth_events';
    const values = [];

    if (client_id) {
      query += ' WHERE client_id = $1';
      values.push(client_id);
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (values.length + 1);
    values.push(parseInt(limit));

    const result = await pgPool.query(query, values);
    res.json({ events: result.rows });
  } catch (err) {
    console.error('Error fetching events:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, () => {
  console.log(`🚀 Meta Central OAuth Broker running on port ${PORT}`);
  console.log(`📍 Base URL: ${BASE_URL}`);
  console.log(`🔗 OAuth Redirect URI: ${OAUTH_REDIRECT_URI}`);
  console.log(`🔑 Meta App ID: ${META_APP_ID}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await pgPool.end();
  await redisClient.quit();
  process.exit(0);
});
