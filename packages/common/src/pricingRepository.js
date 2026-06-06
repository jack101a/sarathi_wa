'use strict';

const { query, run, runTransaction } = require('./db');
const serviceRepository = require('./serviceRepository');

const VALID_SCOPES = new Set(['user', 'group', 'plan']);
const DEFAULT_HEAVY_COST = 50;
let initialized = false;

function normalizeOverride(row) {
  if (!row) return row;
  return {
    ...row,
    credit_cost: Number(row.credit_cost || 0),
    is_active: Number(row.is_active === false ? 0 : row.is_active ?? 1),
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function validateScope(scopeType) {
  if (!VALID_SCOPES.has(scopeType)) {
    throw new Error("scope_type must be 'user', 'group', or 'plan'");
  }
}

function normalizeCost(value) {
  const cost = Number(value);
  if (!Number.isFinite(cost) || cost < 0) throw new Error('credit_cost must be a non-negative number');
  return Math.floor(cost);
}

async function ensureTable() {
  if (initialized) return;
  await query(`
    CREATE TABLE IF NOT EXISTS service_price_overrides (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      scope_type VARCHAR(50) NOT NULL,
      scope_id VARCHAR(255) NOT NULL,
      service_id VARCHAR(255) NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      credit_cost INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      note TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(scope_type, scope_id, service_id)
    )
  `);
  await query('CREATE INDEX IF NOT EXISTS idx_service_price_overrides_lookup ON service_price_overrides(scope_type, scope_id, service_id, is_active)');
  initialized = true;
}

async function listOverrides() {
  await ensureTable();
  const rows = await query(`
    SELECT spo.*,
           s.name AS service_name,
           s.category AS service_category,
           p.name AS plan_name,
           u.canonical_phone AS user_phone,
           u.name AS user_name,
           g.group_id AS group_id,
           g.channel AS group_channel
    FROM service_price_overrides spo
    LEFT JOIN services s ON s.id = spo.service_id
    LEFT JOIN subscription_plans p ON spo.scope_type = 'plan' AND p.id = spo.scope_id
    LEFT JOIN auth_users u ON spo.scope_type = 'user' AND u.id::text = spo.scope_id
    LEFT JOIN authorized_groups g ON spo.scope_type = 'group' AND g.group_id = spo.scope_id
    ORDER BY spo.updated_at DESC, spo.created_at DESC
  `);
  return rows.map(normalizeOverride);
}

async function getOverrideById(id) {
  await ensureTable();
  const rows = await query('SELECT * FROM service_price_overrides WHERE id = ?', [id]);
  return normalizeOverride(rows[0] || null);
}

async function upsertOverride(input = {}) {
  await ensureTable();
  const scopeType = String(input.scope_type || input.scopeType || '').trim().toLowerCase();
  const scopeId = String(input.scope_id || input.scopeId || '').trim();
  const serviceId = String(input.service_id || input.serviceId || '').trim();
  const creditCost = normalizeCost(input.credit_cost ?? input.creditCost);
  const isActive = input.is_active === undefined ? 1 : (input.is_active ? 1 : 0);
  const note = String(input.note || '').trim();

  validateScope(scopeType);
  if (!scopeId) throw new Error('scope_id is required');
  if (!serviceId) throw new Error('service_id is required');
  await validateScopeTarget(scopeType, scopeId);

  await run(`
    INSERT INTO service_price_overrides (scope_type, scope_id, service_id, credit_cost, is_active, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (scope_type, scope_id, service_id)
    DO UPDATE SET credit_cost = EXCLUDED.credit_cost,
                  is_active = EXCLUDED.is_active,
                  note = EXCLUDED.note,
                  updated_at = CURRENT_TIMESTAMP
  `, [scopeType, scopeId, serviceId, creditCost, isActive, note]);

  const rows = await query(
    'SELECT * FROM service_price_overrides WHERE scope_type = ? AND scope_id = ? AND service_id = ?',
    [scopeType, scopeId, serviceId]
  );
  return normalizeOverride(rows[0]);
}

async function updateOverride(id, updates = {}) {
  await ensureTable();
  const existing = await getOverrideById(id);
  if (!existing) throw new Error('Pricing override not found');

  const fields = [];
  const params = [];
  if (updates.credit_cost !== undefined || updates.creditCost !== undefined) {
    fields.push('credit_cost = ?');
    params.push(normalizeCost(updates.credit_cost ?? updates.creditCost));
  }
  if (updates.is_active !== undefined) {
    fields.push('is_active = ?');
    params.push(updates.is_active ? 1 : 0);
  }
  if (updates.note !== undefined) {
    fields.push('note = ?');
    params.push(String(updates.note || '').trim());
  }

  if (fields.length === 0) return existing;
  fields.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);
  await run(`UPDATE service_price_overrides SET ${fields.join(', ')} WHERE id = ?`, params);
  return getOverrideById(id);
}

async function deleteOverride(id) {
  await ensureTable();
  await run('DELETE FROM service_price_overrides WHERE id = ?', [id]);
  return true;
}

async function getUserPlan(userId) {
  if (!userId) return null;
  const rows = await query('SELECT COALESCE(plan_id, ?) AS plan_id FROM auth_users WHERE id = ?', ['free', userId]);
  return rows[0]?.plan_id || null;
}

async function validateScopeTarget(scopeType, scopeId) {
  if (scopeType === 'user') {
    const rows = await query('SELECT 1 FROM auth_users WHERE id = ? LIMIT 1', [scopeId]);
    if (!rows[0]) throw new Error('User pricing target not found');
  } else if (scopeType === 'plan') {
    const rows = await query('SELECT 1 FROM subscription_plans WHERE id = ? LIMIT 1', [scopeId]);
    if (!rows[0]) throw new Error('Plan pricing target not found');
  } else if (scopeType === 'group') {
    const rows = await query('SELECT 1 FROM authorized_groups WHERE group_id = ? AND is_active = 1 LIMIT 1', [scopeId]);
    if (!rows[0]) throw new Error('Group pricing target not found');
  }
}

async function resolveServicePrice({ userId = '', groupId = '', planId = '', serviceId = '' } = {}) {
  await ensureTable();
  const service = serviceRepository.getServiceRegistrySync().get(serviceId);
  const globalCost = Number(service?.credit_cost || 0);
  const effectivePlanId = planId || await getUserPlan(userId);

  if (userId) {
    const rows = await query(
      `SELECT * FROM service_price_overrides
       WHERE scope_type = 'user' AND scope_id = ? AND service_id = ? AND is_active = 1
       LIMIT 1`,
      [userId, serviceId]
    );
    if (rows[0]) return { creditCost: Number(rows[0].credit_cost || 0), source: 'user', override: normalizeOverride(rows[0]) };
  }

  if (groupId) {
    const rows = await query(
      `SELECT * FROM service_price_overrides
       WHERE scope_type = 'group' AND scope_id = ? AND service_id = ? AND is_active = 1
       LIMIT 1`,
      [groupId, serviceId]
    );
    if (rows[0]) return { creditCost: Number(rows[0].credit_cost || 0), source: 'group', override: normalizeOverride(rows[0]) };
  }

  if (effectivePlanId) {
    const rows = await query(
      `SELECT * FROM service_price_overrides
       WHERE scope_type = 'plan' AND scope_id = ? AND service_id = ? AND is_active = 1
       LIMIT 1`,
      [effectivePlanId, serviceId]
    );
    if (rows[0]) return { creditCost: Number(rows[0].credit_cost || 0), source: 'plan', override: normalizeOverride(rows[0]) };
  }

  if (globalCost > 0) return { creditCost: globalCost, source: 'service', override: null };
  return { creditCost: DEFAULT_HEAVY_COST, source: 'fallback', override: null };
}

module.exports = {
  ensureTable,
  listOverrides,
  getOverrideById,
  upsertOverride,
  updateOverride,
  deleteOverride,
  resolveServicePrice,
  DEFAULT_HEAVY_COST,
};
