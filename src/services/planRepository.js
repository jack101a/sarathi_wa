const { query, run } = require('../core/db');

async function getAllPlans() {
  return await query('SELECT * FROM subscription_plans ORDER BY created_at DESC');
}

async function getPlanById(id) {
  const rows = await query('SELECT * FROM subscription_plans WHERE id = ?', [id]);
  return rows[0] || null;
}

async function createPlan(plan) {
  const { id, name, description, services, limits, is_active } = plan;
  const now = new Date().toISOString();
  
  const servicesJson = Array.isArray(services) ? JSON.stringify(services) : JSON.stringify(['*']);
  const limitsJson = limits ? JSON.stringify(limits) : '{}';
  const active = typeof is_active !== 'undefined' ? (is_active ? 1 : 0) : 1;
  
  await run(
    'INSERT INTO subscription_plans (id, name, description, services_json, limits_json, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, name, description || '', servicesJson, limitsJson, active, now]
  );
  
  return await getPlanById(id);
}

async function updatePlan(id, updates) {
  const plan = await getPlanById(id);
  if (!plan) throw new Error(`Plan ${id} not found`);

  const name = updates.name !== undefined ? updates.name : plan.name;
  const description = updates.description !== undefined ? updates.description : plan.description;
  const servicesJson = updates.services !== undefined ? JSON.stringify(updates.services) : plan.services_json;
  const limitsJson = updates.limits !== undefined ? JSON.stringify(updates.limits) : plan.limits_json;
  const is_active = updates.is_active !== undefined ? (updates.is_active ? 1 : 0) : plan.is_active;

  await run(
    'UPDATE subscription_plans SET name = ?, description = ?, services_json = ?, limits_json = ?, is_active = ? WHERE id = ?',
    [name, description, servicesJson, limitsJson, is_active, id]
  );
  
  return await getPlanById(id);
}

async function deletePlan(id) {
  // Guard: prevent deleting plans that users are assigned to
  const users = await query("SELECT COUNT(*) as count FROM auth_users WHERE subscription_plan = ? AND is_active = 1", [id]);
  const count = Number((users[0] && users[0].count) || 0);
  if (count > 0) {
    throw new Error(`Cannot delete plan '${id}': ${count} active user(s) are assigned to it. Reassign them first.`);
  }
  await run('DELETE FROM subscription_plans WHERE id = ?', [id]);
}

module.exports = {
  getAllPlans,
  getPlanById,
  createPlan,
  updatePlan,
  deletePlan
};
