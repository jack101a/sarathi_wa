const { query, run } = require('./db');

let cacheMap = new Map();
let cacheExpiry = 0;
const CACHE_TTL_MS = 60000;

const DEFAULT_SERVICES = [
  ['track', 'DL Status Track', 'light', 'api', 0],
  ['track_multiple', 'Multi-App Tracking', 'light', 'api', 0],
  ['track_rc', 'RC Status Track', 'light', 'api', 0],
  ['track_status', 'Tracking List', 'light', 'api', 0],
  ['add_track', 'Add DL Auto-Track', 'light', 'api', 0],
  ['add_track_rc', 'Add RC Auto-Track', 'light', 'api', 0],
  ['remove_track', 'Remove DL Auto-Track', 'light', 'api', 0],
  ['remove_track_rc', 'Remove RC Auto-Track', 'light', 'api', 0],
  ['list_track', 'List All Tracking', 'light', 'api', 0],
  ['refresh_track', 'Refresh All Tracking', 'light', 'api', 0],
  ['form1', 'Self-Declaration Form', 'light', 'api', 0],
  ['form1a', 'Medical Certificate', 'light', 'api', 0],
  ['form2', 'Form 2 Application', 'light', 'api', 0],
  ['formset', 'Combined Form Set', 'light', 'api', 0],
  ['appl_pdf', 'Acknowledgement Receipt', 'light', 'api', 0],
  ['appl_image', 'Acknowledgement Image', 'light', 'api', 0],
  ['slot_pdf', 'Slot Booking Receipt', 'light', 'api', 0],
  ['alive', 'Bot Health Check', 'light', 'api', 0],
  ['resend_otp', 'LL Password Resend', 'medium', 'api', 0],
  ['llprint_start', 'LL Print / Download', 'medium', 'browser', 0],
  ['fee_print_start', 'Fee Receipt Print', 'medium', 'browser', 0],
  ['pay_fee_start', 'Fee Payment', 'medium', 'browser', 0],
  ['slot_booking_start', 'DL Test Slot Booking', 'medium', 'browser', 0],
  ['dl_info_start', 'DL Info Lookup', 'medium', 'browser', 0],
  ['lledit_start', 'LL Edit', 'heavy', 'browser', 50],
  ['dl_renewal_start', 'DL Renewal / Duplicate', 'heavy', 'browser', 50],
  ['apply_dl_start', 'Apply for New DL', 'heavy', 'browser', 50],
  ['mobupdate_start', 'Mobile Number Update', 'heavy', 'browser', 50],
];

function normalize(row) {
  if (!row) return row;
  return {
    ...row,
    display_name: row.display_name || row.name,
    name: row.name || row.display_name,
    credit_cost: Number(row.credit_cost || 0),
    is_active: Number(row.is_active === false ? 0 : row.is_active ?? 1),
  };
}

function initFallbackCache() {
  for (const [id, name, category, queueType, cost] of DEFAULT_SERVICES) {
    cacheMap.set(id, normalize({ id, name, category, queue_type: queueType, credit_cost: cost, is_active: 1 }));
  }
}
initFallbackCache();

async function refreshCache() {
  try {
    const rows = await query('SELECT id, name, category, queue_type, credit_cost, is_active FROM services');
    if (rows && rows.length > 0) {
      const next = new Map();
      for (const row of rows) next.set(row.id, normalize(row));
      cacheMap = next;
      cacheExpiry = Date.now() + CACHE_TTL_MS;
    }
  } catch (err) {
    console.warn('[serviceRepo] Failed to refresh service cache, using fallback:', err.message);
  }
}

function getServiceRegistrySync() {
  if (Date.now() > cacheExpiry) refreshCache().catch(() => {});
  return cacheMap;
}

function invalidateCache() {
  cacheExpiry = 0;
}

async function getAllServices() {
  const rows = await query('SELECT *, name AS display_name FROM services ORDER BY sort_order ASC, name ASC');
  return rows.map(normalize);
}

async function getServiceById(id) {
  const rows = await query('SELECT *, name AS display_name FROM services WHERE id = ?', [id]);
  return normalize(rows[0] || null);
}

async function getActiveServices() {
  const rows = await query('SELECT *, name AS display_name FROM services WHERE is_active = 1 ORDER BY sort_order ASC, name ASC');
  return rows.map(normalize);
}

async function getServicesByCategory(category) {
  const rows = await query('SELECT *, name AS display_name FROM services WHERE category = ? ORDER BY sort_order ASC, name ASC', [category]);
  return rows.map(normalize);
}

async function createService(service) {
  const {
    id,
    name,
    display_name,
    description = '',
    category = 'light',
    queue_type = 'api',
    credit_cost = 0,
    is_active = 1,
    sort_order = 0,
  } = service;
  const finalName = name || display_name || id;
  await run(
    `INSERT INTO services (id, name, description, category, queue_type, credit_cost, is_active, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [id, finalName, description, category, queue_type, credit_cost, is_active ? 1 : 0, sort_order]
  );
  invalidateCache();
  await refreshCache().catch(() => {});
  return getServiceById(id);
}

async function updateService(id, updates) {
  const fields = [];
  const params = [];
  const supported = {
    name: 'name',
    display_name: 'name',
    description: 'description',
    category: 'category',
    queue_type: 'queue_type',
    credit_cost: 'credit_cost',
    is_active: 'is_active',
    sort_order: 'sort_order',
  };
  for (const [input, column] of Object.entries(supported)) {
    if (updates[input] !== undefined) {
      fields.push(`${column} = ?`);
      params.push(input === 'is_active' ? (updates[input] ? 1 : 0) : updates[input]);
    }
  }
  if (fields.length === 0) return getServiceById(id);
  fields.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);
  await run(`UPDATE services SET ${fields.join(', ')} WHERE id = ?`, params);
  invalidateCache();
  await refreshCache().catch(() => {});
  return getServiceById(id);
}

async function deleteService(id) {
  await run('DELETE FROM services WHERE id = ?', [id]);
  invalidateCache();
  await refreshCache().catch(() => {});
  return true;
}

refreshCache().catch(() => {});

module.exports = {
  getAllServices,
  getServiceById,
  getActiveServices,
  getServicesByCategory,
  createService,
  updateService,
  deleteService,
  getServiceRegistrySync,
  invalidateCache,
  refreshCache,
};
