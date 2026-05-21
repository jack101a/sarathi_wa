const { query, run } = require('../core/db');

function nowIso() { return new Date().toISOString(); }

async function createJob({ id, userId, userPhone, queueType, command, payloadJson, chatId, transport }) {
  await run('INSERT INTO jobs (id, user_id, user_phone, queue_type, command, payload_json, status, chat_id, transport, created_at) VALUES (?, ?, ?, ?, ?, ?, "pending", ?, ?, ?)', [id, userId, userPhone, queueType, command, payloadJson || '{}', chatId, transport || 'whatsapp', nowIso()]);
}

async function updateJobStatus(jobId, status, resultJson = '{}', errorText = '') {
  if (status === 'running') return run('UPDATE jobs SET status = ?, started_at = ? WHERE id = ?', [status, nowIso(), jobId]);
  if (status === 'completed' || status === 'failed') return run('UPDATE jobs SET status = ?, result_json = ?, error_text = ?, completed_at = ? WHERE id = ?', [status, resultJson, errorText, nowIso(), jobId]);
  return run('UPDATE jobs SET status = ?, result_json = ?, error_text = ? WHERE id = ?', [status, resultJson, errorText, jobId]);
}

async function getJobById(jobId) { const rows = await query('SELECT * FROM jobs WHERE id = ?', [jobId]); return rows[0] || null; }
async function getActiveJobsForUser(userId) { return query("SELECT * FROM jobs WHERE user_id = ? AND status IN ('pending','running')", [userId]); }
async function getPendingJobs(queueType, limit = 10) { return query('SELECT * FROM jobs WHERE queue_type = ? AND status = "pending" ORDER BY created_at ASC LIMIT ?', [queueType, limit]); }
async function cleanupOldJobs(days = 30) { return run("DELETE FROM jobs WHERE status IN ('completed','failed') AND completed_at != '' AND completed_at < datetime('now', ?)", [`-${Number(days) || 30} days`]); }

async function queryJobs(filters = {}) {
  let sql = 'SELECT * FROM jobs WHERE 1=1';
  const params = [];
  if (filters.status)  { sql += ' AND status = ?';    params.push(filters.status); }
  if (filters.userId)  { sql += ' AND user_id = ?';   params.push(filters.userId); }
  if (filters.command) { sql += ' AND command = ?';    params.push(filters.command); }
  if (filters.from)    { sql += ' AND created_at >= ?'; params.push(filters.from); }
  if (filters.to)      { sql += ' AND created_at <= ?'; params.push(filters.to); }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(Math.min(Number(filters.limit) || 100, 500));
  params.push(Number(filters.offset) || 0);
  return query(sql, params);
}

async function cancelJob(jobId) {
  const job = await getJobById(jobId);
  if (!job || job.status !== 'pending') return false;
  await run("UPDATE jobs SET status = 'cancelled', completed_at = ? WHERE id = ? AND status = 'pending'", [nowIso(), jobId]);
  return true;
}

module.exports = { createJob, updateJobStatus, getJobById, getActiveJobsForUser, getPendingJobs, cleanupOldJobs, queryJobs, cancelJob };

