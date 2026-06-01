const { query, run, runTransaction } = require('./db');

function normalizePlan(row, services = undefined) {
  if (!row) return row;
  const limits = typeof row.limits_json === 'string' ? row.limits_json : JSON.stringify(row.limits_json || {});
  const serviceList = services || [];
  return {
    ...row,
    limits_json: limits,
    services,
    services_json: JSON.stringify(serviceList),
  };
}

async function getPlanServices(planId) {
  const rows = await query('SELECT service_id FROM plan_services WHERE plan_id = ? ORDER BY service_id ASC', [planId]);
  return rows.map((r) => r.service_id);
}

async function getAllPlans() {
  const rows = await query('SELECT * FROM subscription_plans ORDER BY created_at DESC');
  const plans = [];
  for (const row of rows) plans.push(normalizePlan(row, await getPlanServices(row.id)));
  return plans;
}

async function getPlanById(id) {
  const rows = await query('SELECT * FROM subscription_plans WHERE id = ?', [id]);
  if (!rows[0]) return null;
  return normalizePlan(rows[0], await getPlanServices(id));
}

async function replacePlanServices(txR, id, services) {
  await txR('DELETE FROM plan_services WHERE plan_id = ?', [id]);
  const serviceIds = Array.isArray(services) ? services : [];
  if (serviceIds.includes('*')) {
    await txR("INSERT INTO plan_services (plan_id, service_id) SELECT ?, id FROM services ON CONFLICT DO NOTHING", [id]);
    return;
  }
  for (const serviceId of serviceIds) {
    await txR('INSERT INTO plan_services (plan_id, service_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [id, serviceId]);
  }
}

async function createPlan(plan) {
  const { id, name, description = '', services = [], limits = {}, is_active = 1 } = plan || {};
  if (!id || !name) throw new Error('Plan id and name are required');
  await runTransaction(async ({ run: txR }) => {
    await txR(
      `INSERT INTO subscription_plans (id, name, description, limits_json, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?::jsonb, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [id, name, description, JSON.stringify(limits || {}), is_active ? 1 : 0]
    );
    await replacePlanServices(txR, id, services);
  });
  return getPlanById(id);
}

async function updatePlan(id, updates = {}) {
  const existing = await getPlanById(id);
  if (!existing) throw new Error(`Plan ${id} not found`);
  const fields = [];
  const params = [];
  if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
  if (updates.description !== undefined) { fields.push('description = ?'); params.push(updates.description); }
  if (updates.limits !== undefined) { fields.push('limits_json = ?::jsonb'); params.push(JSON.stringify(updates.limits || {})); }
  if (updates.is_active !== undefined) { fields.push('is_active = ?'); params.push(updates.is_active ? 1 : 0); }
  fields.push('updated_at = CURRENT_TIMESTAMP');
  await runTransaction(async ({ run: txR }) => {
    if (fields.length > 0) {
      params.push(id);
      await txR(`UPDATE subscription_plans SET ${fields.join(', ')} WHERE id = ?`, params);
    }
    if (updates.services !== undefined) {
      await replacePlanServices(txR, id, updates.services);
    }
  });
  return getPlanById(id);
}

async function deletePlan(id) {
  const users = await query('SELECT COUNT(*) AS count FROM auth_users WHERE plan_id = ? AND is_active = 1', [id]);
  const count = Number(users[0]?.count || 0);
  if (count > 0) throw new Error(`Cannot delete plan '${id}': ${count} active user(s) are assigned to it. Reassign them first.`);
  await run('DELETE FROM subscription_plans WHERE id = ?', [id]);
}

module.exports = { getAllPlans, getPlanById, createPlan, updatePlan, deletePlan, getPlanServices };
