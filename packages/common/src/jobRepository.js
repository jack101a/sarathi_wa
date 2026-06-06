const { query, run, runTransaction } = require('./db');
const crypto = require('crypto');

function nowIso() { return new Date().toISOString(); }
function makeJobId() { return `job_${crypto.randomUUID()}`; }

function normalizeJob(row) {
  if (!row) return row;
  const payload = row.payload || {};
  const result = row.result || {};
  return {
    ...row,
    payload,
    result,
    payload_json: typeof payload === 'string' ? payload : JSON.stringify(payload),
    result_json: typeof result === 'string' ? result : JSON.stringify(result),
  };
}

async function createJob({ id, userId, userPhone, queueType, command, payloadJson, payload, chatId, transport, priority = 0, dedupKey }) {
  const jobId = id || makeJobId();
  const body = payload || JSON.parse(payloadJson || '{}');
  const rows = await query(
    `INSERT INTO jobs (id, user_id, user_phone, queue_type, command, payload, status, chat_id, transport, priority, dedup_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?::jsonb, 'pending', ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [jobId, userId || null, userPhone || '', queueType, command, JSON.stringify(body || {}), chatId, transport || 'wa', priority, dedupKey || jobId]
  );

  const created = rows[0] || null;

  if (created) {
    try {
      const { redis } = require('./redis');
      await redis.publish('admin:broadcast', JSON.stringify({
        event: 'job_created',
        job: { id: jobId, user_id: userId || null, user_phone: userPhone || '', queue_type: queueType, command, status: 'pending', created_at: nowIso() }
      }));
    } catch (_) {}

    const normalized = normalizeJob(created);
    normalized.created = true;
    return normalized;
  }

  const existingRows = dedupKey
    ? await query('SELECT * FROM jobs WHERE dedup_key = ? OR id = ? ORDER BY created_at DESC LIMIT 1', [dedupKey, jobId])
    : await query('SELECT * FROM jobs WHERE id = ?', [jobId]);
  const existing = normalizeJob(existingRows[0] || null);
  if (existing) existing.created = false;
  return existing;
}

async function updateJobStatus(jobId, status, resultJson = '{}', errorText = '', workerId = '') {
  let result;
  if (status === 'running') {
    result = await run('UPDATE jobs SET status = ?, started_at = CURRENT_TIMESTAMP, worker_id = COALESCE(NULLIF(?, \'\'), worker_id) WHERE id = ?', [status, workerId, jobId]);
  } else if (status === 'completed' || status === 'failed') {
    result = await run('UPDATE jobs SET status = ?, result = ?::jsonb, error_text = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?', [status, resultJson || '{}', errorText, jobId]);
  } else {
    result = await run('UPDATE jobs SET status = ?, result = ?::jsonb, error_text = ? WHERE id = ?', [status, resultJson || '{}', errorText, jobId]);
  }

  try {
    const { redis } = require('./redis');
    await redis.publish('admin:broadcast', JSON.stringify({
      event: 'job_updated',
      jobId,
      status,
      result_json: resultJson,
      error_text: errorText,
      timestamp: nowIso()
    }));
  } catch (_) {}

  return result;
}

async function getJobById(jobId) {
  const rows = await query('SELECT * FROM jobs WHERE id = ?', [jobId]);
  return normalizeJob(rows[0] || null);
}

async function getActiveJobsForUser(userId) {
  const rows = await query("SELECT * FROM jobs WHERE user_id = ? AND status IN ('pending','running')", [userId]);
  return rows.map(normalizeJob);
}

async function getPendingJobs(queueType, limit = 10) {
  const rows = await query('SELECT * FROM jobs WHERE queue_type = ? AND status = \'pending\' ORDER BY created_at ASC LIMIT ?', [queueType, limit]);
  return rows.map(normalizeJob);
}

async function cleanupOldJobs(days = 30) {
  const cutoff = new Date(Date.now() - (Number(days) || 30) * 24 * 60 * 60 * 1000).toISOString();
  return run("DELETE FROM jobs WHERE status IN ('completed','failed') AND completed_at IS NOT NULL AND completed_at < ?", [cutoff]);
}

async function queryJobs(filters = {}) {
  let sql = 'SELECT * FROM jobs WHERE 1=1';
  const params = [];
  if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
  if (filters.userId) {
    sql += ' AND (user_id::text = ? OR user_phone = ?)';
    params.push(filters.userId, filters.userId);
  }
  if (filters.command) { sql += ' AND command = ?'; params.push(filters.command); }
  if (filters.from) { sql += ' AND created_at >= ?'; params.push(filters.from); }
  if (filters.to) { sql += ' AND created_at <= ?'; params.push(filters.to); }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(Math.min(Number(filters.limit) || 100, 500));
  params.push(Number(filters.offset) || 0);
  const rows = await query(sql, params);
  return rows.map(normalizeJob);
}

async function cancelJob(jobId) {
  const result = await cancelJobs([jobId]);
  return result.cancelledIds.includes(jobId);
}

function getReservedCreditAmount(job) {
  const payload = job && job.payload && typeof job.payload === 'object' ? job.payload : {};
  const billing = payload.__billing && typeof payload.__billing === 'object' ? payload.__billing : {};
  if (!billing.creditReserved) return 0;
  return Math.max(0, Number(billing.creditCost) || 0);
}

async function cancelJobs(jobIds = []) {
  const ids = [...new Set((Array.isArray(jobIds) ? jobIds : []).map(String).filter(Boolean))];
  if (ids.length === 0) return { cancelledIds: [], releasedCredits: 0 };

  const result = await runTransaction(async ({ query: txQuery, run: txRun }) => {
    const placeholders = ids.map(() => '?').join(', ');
    const jobs = await txQuery(
      `SELECT id, user_id, payload
       FROM jobs
       WHERE id IN (${placeholders}) AND status = 'pending'
       FOR UPDATE`,
      ids
    );

    if (jobs.length === 0) return { cancelledIds: [], releasedCredits: 0 };

    const releaseByUser = new Map();
    for (const job of jobs) {
      const amount = getReservedCreditAmount(job);
      if (!job.user_id || amount <= 0) continue;
      releaseByUser.set(job.user_id, (releaseByUser.get(job.user_id) || 0) + amount);
    }

    let releasedCredits = 0;
    for (const [userId, amount] of releaseByUser) {
      const [user] = await txQuery(
        'SELECT COALESCE(reserved_credits,0) AS reserved_credits FROM auth_users WHERE id = ? FOR UPDATE',
        [userId]
      );
      const released = Math.min(amount, Number(user?.reserved_credits || 0));
      if (released <= 0) continue;
      await txRun(
        'UPDATE auth_users SET reserved_credits = GREATEST(COALESCE(reserved_credits,0) - ?, 0), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [released, userId]
      );
      releasedCredits += released;
    }

    const cancelledIds = jobs.map((job) => job.id);
    const cancelPlaceholders = cancelledIds.map(() => '?').join(', ');
    await txRun(
      `UPDATE jobs
       SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP
       WHERE id IN (${cancelPlaceholders}) AND status = 'pending'`,
      cancelledIds
    );

    return { cancelledIds, releasedCredits };
  });

  try {
    const { redis } = require('./redis');
    await Promise.all(result.cancelledIds.map((jobId) => redis.publish('admin:broadcast', JSON.stringify({
      event: 'job_updated',
      jobId,
      status: 'cancelled',
      timestamp: nowIso(),
    }))));
  } catch (_) {}

  return result;
}

module.exports = {
  createJob,
  updateJobStatus,
  getJobById,
  getActiveJobsForUser,
  getPendingJobs,
  cleanupOldJobs,
  queryJobs,
  cancelJob,
  cancelJobs,
  getReservedCreditAmount,
  normalizeJob,
};
