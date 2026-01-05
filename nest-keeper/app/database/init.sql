-- Central OAuth Broker Database Schema

-- Client-VM Registry: Maps clients to their VMs
CREATE TABLE IF NOT EXISTS client_vm_registry (
  id SERIAL PRIMARY KEY,
  client_id VARCHAR(255) UNIQUE NOT NULL,
  client_name VARCHAR(255) NOT NULL,

  -- VM connection details
  vm_url VARCHAR(512) NOT NULL,
  vm_api_key VARCHAR(255) NOT NULL,

  -- Status
  status VARCHAR(50) DEFAULT 'active',

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_oauth_at TIMESTAMP,

  -- Index for fast lookups
  CONSTRAINT unique_client_id UNIQUE (client_id),
  CONSTRAINT unique_vm_url UNIQUE (vm_url)
);

-- OAuth Events Log: Track all OAuth flows
CREATE TABLE IF NOT EXISTS oauth_events (
  id SERIAL PRIMARY KEY,
  client_id VARCHAR(255),
  event_type VARCHAR(100) NOT NULL,

  -- OAuth details
  state_param TEXT,
  auth_code TEXT,
  error_message TEXT,

  -- Platform
  platform VARCHAR(50),
  platform_data JSONB,

  -- Meta account info (deprecated, kept for backward compatibility)
  meta_user_id VARCHAR(255),
  instagram_business_account_id VARCHAR(255),
  ad_account_id VARCHAR(255),

  -- Forwarding details
  vm_url VARCHAR(512),
  forwarding_status VARCHAR(50),
  forwarding_response TEXT,

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),

  -- Indexes
  INDEX idx_client_id (client_id),
  INDEX idx_event_type (event_type),
  INDEX idx_created_at (created_at),
  INDEX idx_platform (platform)
);

-- App Testers: Track which Meta users are registered as testers
CREATE TABLE IF NOT EXISTS app_testers (
  id SERIAL PRIMARY KEY,
  client_id VARCHAR(255) NOT NULL,

  -- Meta account info
  facebook_user_id VARCHAR(255),
  facebook_name VARCHAR(255),
  facebook_email VARCHAR(255),

  -- Tester status
  tester_status VARCHAR(50) DEFAULT 'pending',
  invited_at TIMESTAMP DEFAULT NOW(),
  accepted_at TIMESTAMP,

  -- Notes
  notes TEXT,

  CONSTRAINT fk_client FOREIGN KEY (client_id) REFERENCES client_vm_registry(client_id),
  INDEX idx_client_tester (client_id),
  INDEX idx_facebook_user (facebook_user_id)
);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_client_vm_registry_updated_at
  BEFORE UPDATE ON client_vm_registry
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Insert a sample client for testing
INSERT INTO client_vm_registry (client_id, client_name, vm_url, vm_api_key, status)
VALUES (
  'test-client-a',
  'Test Client A',
  'https://clienta-stack.yourdomain.com',
  'change_this_to_secure_api_key',
  'active'
) ON CONFLICT (client_id) DO NOTHING;

-- Grant permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO oauth_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO oauth_user;
