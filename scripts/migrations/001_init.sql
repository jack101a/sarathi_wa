CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS subscription_plans (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT DEFAULT '',
  is_active INTEGER DEFAULT 1,
  limits_json JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS services (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT DEFAULT '',
  category VARCHAR(50) NOT NULL DEFAULT 'light',
  queue_type VARCHAR(50) NOT NULL DEFAULT 'api',
  credit_cost INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS plan_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id VARCHAR(255) REFERENCES subscription_plans(id) ON DELETE CASCADE,
  service_id VARCHAR(255) REFERENCES services(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(plan_id, service_id)
);

CREATE TABLE IF NOT EXISTS auth_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel VARCHAR(50) DEFAULT 'wa',
  canonical_phone VARCHAR(255) UNIQUE NOT NULL,
  is_active INTEGER DEFAULT 1,
  name VARCHAR(255) DEFAULT '',
  plan_id VARCHAR(255) REFERENCES subscription_plans(id) ON DELETE SET NULL,
  credits INTEGER DEFAULT 0,
  reserved_credits INTEGER DEFAULT 0,
  used_count INTEGER DEFAULT 0,
  daily_count INTEGER DEFAULT 0,
  expiry_date TIMESTAMPTZ,
  billing_cycle_start TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  last_daily_reset TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  rate_limit_overrides JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auth_user_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  identity_type VARCHAR(50) NOT NULL,
  identity_value VARCHAR(255) UNIQUE NOT NULL,
  verified_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS auth_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel VARCHAR(50) DEFAULT 'wa',
  canonical_phone VARCHAR(255) NOT NULL,
  code VARCHAR(50) NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  requested_by VARCHAR(255),
  requested_via VARCHAR(50) DEFAULT 'wa',
  expires_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  verified_identity VARCHAR(255),
  meta_json JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS authorized_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel VARCHAR(50) NOT NULL,
  group_id VARCHAR(255) NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_by VARCHAR(255) DEFAULT 'admin',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(channel, group_id)
);

CREATE TABLE IF NOT EXISTS credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth_users(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,
  amount INTEGER NOT NULL,
  balance_before INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  note TEXT DEFAULT '',
  triggered_by VARCHAR(50) DEFAULT 'system',
  job_id VARCHAR(255),
  payment_reference VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS jobs (
  id VARCHAR(255) PRIMARY KEY,
  user_id UUID REFERENCES auth_users(id) ON DELETE SET NULL,
  user_phone VARCHAR(255),
  queue_type VARCHAR(50) NOT NULL,
  command VARCHAR(255) NOT NULL,
  payload JSONB DEFAULT '{}'::jsonb,
  status VARCHAR(50) DEFAULT 'pending',
  result JSONB DEFAULT '{}'::jsonb,
  error_text TEXT,
  chat_id VARCHAR(255) NOT NULL,
  transport VARCHAR(50) DEFAULT 'wa',
  priority INTEGER DEFAULT 0,
  worker_id VARCHAR(255),
  dedup_key VARCHAR(255) UNIQUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS rate_limit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth_users(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL,
  command VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'light'
);

CREATE TABLE IF NOT EXISTS tracked_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth_users(id) ON DELETE CASCADE,
  app_number VARCHAR(255) NOT NULL,
  app_type VARCHAR(50) NOT NULL,
  chat_id VARCHAR(255) NOT NULL,
  transport VARCHAR(50) NOT NULL,
  last_snapshot JSONB DEFAULT '{}'::jsonb,
  last_signature VARCHAR(255),
  last_checked_at TIMESTAMPTZ,
  meta_json JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(app_type, transport, chat_id, app_number)
);

CREATE TABLE IF NOT EXISTS payment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth_users(id) ON DELETE CASCADE,
  utr VARCHAR(255) UNIQUE NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(50) DEFAULT 'pending',
  admin_note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  verified_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ai_layout_mappings (
  layout_hash VARCHAR(255) PRIMARY KEY,
  portal_type VARCHAR(50) NOT NULL,
  mapping_rules TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_identities_user_fk ON auth_user_identities(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON jobs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_queue_status ON jobs(queue_type, status);
CREATE INDEX IF NOT EXISTS idx_rate_log_user ON rate_limit_log(user_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_rate_log_cat ON rate_limit_log(user_id, category, timestamp);
CREATE INDEX IF NOT EXISTS idx_credit_tx_user ON credit_transactions(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tracked_applications_chat ON tracked_applications(app_type, transport, chat_id);
CREATE INDEX IF NOT EXISTS idx_tracked_applications_app ON tracked_applications(app_type, app_number);
CREATE INDEX IF NOT EXISTS idx_payment_req_status ON payment_requests(status);
