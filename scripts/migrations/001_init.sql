-- Enable UUID extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Subscription Plans Table
CREATE TABLE IF NOT EXISTS subscription_plans (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  limits_json JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Services Table
CREATE TABLE IF NOT EXISTS services (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(50) DEFAULT 'light', -- light, medium, heavy
  queue_type VARCHAR(50) DEFAULT 'api',  -- api, browser
  credit_cost INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0
);

-- 3. Users Table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel VARCHAR(50) DEFAULT 'wa', -- wa, tg
  canonical_phone VARCHAR(255) UNIQUE NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  name VARCHAR(255) DEFAULT '',
  plan_id VARCHAR(255) REFERENCES subscription_plans(id) ON DELETE SET NULL,
  credits INTEGER DEFAULT 0,
  used_count INTEGER DEFAULT 0,
  daily_count INTEGER DEFAULT 0,
  expiry_date TIMESTAMP WITH TIME ZONE,
  billing_cycle_start TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  last_daily_reset TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Plan Services Junction Table
CREATE TABLE IF NOT EXISTS plan_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id VARCHAR(255) REFERENCES subscription_plans(id) ON DELETE CASCADE,
  service_id VARCHAR(255) REFERENCES services(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(plan_id, service_id)
);

-- 5. Credit Transactions Table
CREATE TABLE IF NOT EXISTS credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL, -- add, deduct, topup, auto_deduct
  amount INTEGER NOT NULL,
  balance_before INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  note TEXT,
  triggered_by VARCHAR(50) DEFAULT 'system', -- admin, system, payment
  job_id VARCHAR(255),
  payment_reference VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Jobs Table
CREATE TABLE IF NOT EXISTS jobs (
  id VARCHAR(255) PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  user_phone VARCHAR(255),
  queue_type VARCHAR(50) NOT NULL,
  command VARCHAR(255) NOT NULL,
  payload JSONB DEFAULT '{}'::jsonb,
  status VARCHAR(50) DEFAULT 'pending', -- pending, running, completed, failed, cancelled
  result JSONB DEFAULT '{}'::jsonb,
  error_text TEXT,
  chat_id VARCHAR(255) NOT NULL,
  transport VARCHAR(50) DEFAULT 'wa', -- wa, tg
  priority INTEGER DEFAULT 0,
  worker_id VARCHAR(255),
  dedup_key VARCHAR(255) UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON jobs(user_id, status);

-- 7. Tracked Applications Table
CREATE TABLE IF NOT EXISTS tracked_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  app_number VARCHAR(255) UNIQUE NOT NULL,
  app_type VARCHAR(50) NOT NULL, -- sarathi, vahan
  chat_id VARCHAR(255) NOT NULL,
  transport VARCHAR(50) NOT NULL,
  last_snapshot JSONB DEFAULT '{}'::jsonb,
  last_signature VARCHAR(255),
  last_checked_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. Payment Requests Table
CREATE TABLE IF NOT EXISTS payment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  utr VARCHAR(255) UNIQUE NOT NULL,
  amount INTEGER NOT NULL,
  status VARCHAR(50) DEFAULT 'pending', -- pending, approved, rejected
  admin_note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  verified_at TIMESTAMP WITH TIME ZONE
);

-- 9. AI Layout Mappings Table
CREATE TABLE IF NOT EXISTS ai_layout_mappings (
  layout_hash VARCHAR(255) PRIMARY KEY,
  portal_type VARCHAR(50) NOT NULL,
  mapping_rules TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert Default Subscription Plans
INSERT INTO subscription_plans (id, name, description, limits_json) VALUES
('free', 'Free Tier', 'Default limited plan', '{"perMinute": 5, "perDay": 100, "perMonth": 50, "maxConcurrent": 2}'::jsonb),
('premium', 'Premium Tier', 'Standard premium plan', '{"perMinute": 15, "perDay": 300, "perMonth": 500, "maxConcurrent": 5}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Insert Default Services
INSERT INTO services (id, name, category, queue_type, credit_cost, sort_order) VALUES
('track', 'DL Status Track', 'light', 'api', 1, 1),
('form1', 'Download Form 1', 'light', 'api', 1, 2),
('form1a', 'Download Form 1A', 'light', 'api', 1, 3),
('form2', 'Download Form 2', 'light', 'api', 1, 4),
('formset', 'Formset Download', 'light', 'api', 2, 5),
('track_rc', 'Vahan RC Track', 'light', 'api', 2, 6),
('appl', 'Acknowledgment PDF', 'heavy', 'browser', 3, 7),
('llprint', 'LL Print Flow', 'heavy', 'browser', 5, 8),
('dl_renewal', 'DL Renewal', 'heavy', 'browser', 10, 9),
('dl_apply', 'DL Application', 'heavy', 'browser', 15, 10)
ON CONFLICT (id) DO NOTHING;

-- Map Services to Premium Plan
INSERT INTO plan_services (plan_id, service_id)
SELECT 'premium', id FROM services
ON CONFLICT DO NOTHING;

-- Map Services to Free Plan (Free plan has access to light services only)
INSERT INTO plan_services (plan_id, service_id)
SELECT 'free', id FROM services WHERE category = 'light'
ON CONFLICT DO NOTHING;
