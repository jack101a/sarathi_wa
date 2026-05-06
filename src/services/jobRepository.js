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

module.exports = { createJob, updateJobStatus, getJobById, getActiveJobsForUser, getPendingJobs, cleanupOldJobs };
