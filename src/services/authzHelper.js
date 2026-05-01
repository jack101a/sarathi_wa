const fs = require('fs');
const sqlite3 = require('sqlite3');
const path = require('path');

const dbPath = process.env.AUTHZ_DB_PATH || path.resolve(__dirname, '../../data/authz.sqlite');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);

function initDb() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS auth_users (
          id TEXT PRIMARY KEY,
          channel TEXT,
          canonical_phone TEXT UNIQUE,
          is_active INTEGER,
          created_at TEXT,
          updated_at TEXT
        )
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS auth_user_identities (
          id TEXT PRIMARY KEY,
          auth_user_id TEXT,
          identity_type TEXT,
          identity_value TEXT UNIQUE,
          verified_at TEXT,
          last_seen_at TEXT,
          is_active INTEGER
        )
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS auth_verifications (
          id TEXT PRIMARY KEY,
          channel TEXT,
          canonical_phone TEXT,
          code TEXT,
          status TEXT,
          requested_by TEXT,
          requested_via TEXT,
          expires_at TEXT,
          verified_at TEXT,
          verified_identity TEXT,
          meta_json TEXT
        )
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS authorized_groups (
          id TEXT PRIMARY KEY,
          channel TEXT,
          group_id TEXT,
          is_active INTEGER,
          created_by TEXT,
          created_at TEXT
        )
      `, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

const command = process.argv[2];
if (command === 'init') {
  initDb()
    .then(() => {
      db.close();
    })
    .catch((err) => {
      console.error(err);
      db.close();
      process.exit(1);
    });
} else if (command === 'query') {
  let input = '';
  process.stdin.on('data', (chunk) => {
    input += chunk;
  });
  process.stdin.on('end', () => {
    const payload = JSON.parse(input);
    db.all(payload.sql, payload.params || [], (err, rows) => {
      if (err) {
        console.error(err);
        db.close();
        process.exit(1);
      } else {
        console.log(JSON.stringify(rows || []));
        db.close();
      }
    });
  });
} else if (command === 'run') {
  let input = '';
  process.stdin.on('data', (chunk) => {
    input += chunk;
  });
  process.stdin.on('end', () => {
    const payload = JSON.parse(input);
    db.run(payload.sql, payload.params || [], (err) => {
      if (err) {
        console.error(err);
        db.close();
        process.exit(1);
      } else {
        console.log(JSON.stringify({ success: true }));
        db.close();
      }
    });
  });
}
