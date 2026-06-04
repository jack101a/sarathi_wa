'use strict';

// Legacy CLI compatibility helper.
// The project is PostgreSQL-backed now; this file intentionally delegates to the
// shared Postgres repository instead of opening the old SQLite database.
const { authorizationRepository: authRepo } = require('@sarathi/common');

async function readStdinJson() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return JSON.parse(input || '{}');
}

async function main() {
  const command = process.argv[2];

  if (command === 'init') {
    await authRepo.initDb();
    return;
  }

  if (command === 'query') {
    const payload = await readStdinJson();
    const rows = await authRepo.query(payload.sql, payload.params || []);
    console.log(JSON.stringify(rows || []));
    return;
  }

  if (command === 'run') {
    const payload = await readStdinJson();
    const result = await authRepo.run(payload.sql, payload.params || []);
    console.log(JSON.stringify({ success: true, changes: result.changes || 0, lastID: result.lastID || null }));
    return;
  }

  console.error('Usage: node src/services/authzHelper.js <init|query|run>');
  process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = { main };
