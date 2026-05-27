const { query, run } = require('../core/db');

// In-memory cache Map
let cacheMap = new Map();
let cacheExpiry = 0;
const CACHE_TTL_MS = 60000; // 60 seconds

// 29 Static default services as fallback to prevent any race condition during early boot
const DEFAULT_SERVICES = [
  { id: 'track', category: 'light', queue_type: 'api', credit_cost: 0, is_active: 1 },
  { id: 'track_rc', category: 'light', queue_type: 'api', credit_cost: 0, is_active: 1 },
  { id: 'track_status', category: 'light', queue_type: 'api', credit_cost: 0, is_active: 1 },
  { id: 'add_track', category: 'light', queue_type: 'api', credit_cost: 0, is_active: 1 },
  { id: 'remove_track', category: 'light', queue_type: 'api', credit_cost: 0, is_active: 1 },
  { id: 'list_track', category: 'light', queue_type: 'api', credit_cost: 0, is_active: 1 },
  { id: 'refresh_track', category: 'light', queue_type: 'api', credit_cost: 0, is_active: 1 },
  { id: 'form1', category: 'light', queue_type: 'api', credit_cost: 0, is_active: 1 },
  { id: 'form1a', category: 'light', queue_type: 'api', credit_cost: 0, is_active: 1 },
  { id: 'form2', category: 'light', queue_type: 'api', credit_cost: 0, is_active: 1 },
  { id: 'formset', category: 'light', queue_type: 'api', credit_cost: 0, is_active: 1 },
  { id: 'appl_pdf', category: 'light', queue_type: 'api', credit_cost: 0, is_active: 1 },
  { id: 'slot_pdf', category: 'light', queue_type: 'api', credit_cost: 0, is_active: 1 },
  { id: 'alive', category: 'light', queue_type: 'api', credit_cost: 0, is_active: 1 },
  { id: 'vahan_track', category: 'light', queue_type: 'api', credit_cost: 0, is_active: 1 },
  { id: 'vahan_add', category: 'light', queue_type: 'api', credit_cost: 0, is_active: 1 },
  { id: 'vahan_remove', category: 'light', queue_type: 'api', credit_cost: 0, is_active: 1 },
  { id: 'vahan_list', category: 'light', queue_type: 'api', credit_cost: 0, is_active: 1 },
  { id: 'vahan_refresh', category: 'light', queue_type: 'api', credit_cost: 0, is_active: 1 },
  { id: 'resend_otp', category: 'medium', queue_type: 'api', credit_cost: 0, is_active: 1 },
  { id: 'llprint_start', category: 'medium', queue_type: 'browser', credit_cost: 0, is_active: 1 },
  { id: 'fee_print_start', category: 'medium', queue_type: 'browser', credit_cost: 0, is_active: 1 },
  { id: 'pay_fee_start', category: 'medium', queue_type: 'browser', credit_cost: 0, is_active: 1 },
  { id: 'slot_booking_start', category: 'medium', queue_type: 'browser', credit_cost: 0, is_active: 1 },
  { id: 'dl_info_start', category: 'medium', queue_type: 'browser', credit_cost: 0, is_active: 1 },
  { id: 'lledit_start', category: 'heavy', queue_type: 'browser', credit_cost: 50, is_active: 1 },
  { id: 'dl_renewal_start', category: 'heavy', queue_type: 'browser', credit_cost: 50, is_active: 1 },
  { id: 'apply_dl_start', category: 'heavy', queue_type: 'browser', credit_cost: 50, is_active: 1 },
  { id: 'mobupdate_start', category: 'heavy', queue_type: 'browser', credit_cost: 50, is_active: 1 }
];

// Seed initial in-memory cache with fallback values
function initFallbackCache() {
  for (const s of DEFAULT_SERVICES) {
    cacheMap.set(s.id, {
      category: s.category,
      queue_type: s.queue_type,
      credit_cost: s.credit_cost,
      is_active: s.is_active
    });
  }
}
initFallbackCache();

/**
 * Asynchronously refreshes the service cache from the DB.
 */
async function refreshCache() {
  try {
    const rows = await query('SELECT id, category, queue_type, credit_cost, is_active FROM services');
    if (rows && rows.length > 0) {
      const newMap = new Map();
      for (const row of rows) {
        newMap.set(row.id, {
          category: row.category,
          queue_type: row.queue_type,
          credit_cost: Number(row.credit_cost || 0),
          is_active: Number(row.is_active === 1 ? 1 : 0)
        });
      }
      cacheMap = newMap;
      cacheExpiry = Date.now() + CACHE_TTL_MS;
    }
  } catch (err) {
    // If DB is not ready or table doesn't exist, we keep using our fallback cacheMap
    console.warn('[serviceRepo] Failed to refresh service cache, using fallback:', err.message);
  }
}

// Eagerly trigger an initial cache load
refreshCache().catch(() => {});

/**
 * Synchronously retrieves the current service registry Map.
 * Automatically triggers background cache refresh if expired.
 */
function getServiceRegistrySync() {
  if (Date.now() > cacheExpiry) {
    refreshCache().catch(() => {});
  }
  return cacheMap;
}

/**
 * Clear/Invalidate the cache to force a fresh DB reload.
 */
function invalidateCache() {
  cacheExpiry = 0;
}

/**
 * Fetches all services ordered by sort_order and display_name.
 */
async function getAllServices() {
  return query('SELECT * FROM services ORDER BY sort_order ASC, display_name ASC');
}

/**
 * Fetches a single service by its ID.
 */
async function getServiceById(id) {
  const rows = await query('SELECT * FROM services WHERE id = ?', [id]);
  return rows[0] || null;
}

/**
 * Fetches active services only.
 */
async function getActiveServices() {
  return query('SELECT * FROM services WHERE is_active = 1 ORDER BY sort_order ASC, display_name ASC');
}

/**
 * Fetches services belonging to a specific category.
 */
async function getServicesByCategory(category) {
  return query('SELECT * FROM services WHERE category = ? ORDER BY sort_order ASC, display_name ASC', [category]);
}

/**
 * Creates a new service.
 */
async function createService(service) {
  const { id, display_name, description = '', category = 'light', queue_type = 'api', credit_cost = 0, is_active = 1, sort_order = 0 } = service;
  const now = new Date().toISOString();
  await run(
    'INSERT INTO services (id, display_name, description, category, queue_type, credit_cost, is_active, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, display_name, description, category, queue_type, credit_cost, is_active, sort_order, now, now]
  );
  invalidateCache();
  await refreshCache().catch(() => {});
  return getServiceById(id);
}

/**
 * Updates an existing service dynamically.
 */
async function updateService(id, updates) {
  const fields = [];
  const params = [];
  
  // Dynamic SQL building for updates
  const supportedFields = ['display_name', 'description', 'category', 'queue_type', 'credit_cost', 'is_active', 'sort_order'];
  for (const field of supportedFields) {
    if (updates[field] !== undefined) {
      fields.push(`${field} = ?`);
      params.push(updates[field]);
    }
  }

  if (fields.length === 0) return getServiceById(id);

  fields.push('updated_at = ?');
  params.push(new Date().toISOString());
  
  params.push(id);

  await run(`UPDATE services SET ${fields.join(', ')} WHERE id = ?`, params);
  invalidateCache();
  await refreshCache().catch(() => {});
  return getServiceById(id);
}

/**
 * Deletes a service from the DB.
 */
async function deleteService(id) {
  await run('DELETE FROM services WHERE id = ?', [id]);
  invalidateCache();
  await refreshCache().catch(() => {});
  return true;
}

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
  refreshCache
};
