const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const dbPath = process.env.AUTHZ_DB_PATH || path.resolve(__dirname, '../../data/authz.sqlite');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

let db;

function getDb() {
  if (db) return db;
  db = new sqlite3.Database(dbPath);
  db.serialize(() => {
    db.run('PRAGMA journal_mode=WAL');
    db.run('PRAGMA busy_timeout=5000');
    db.run('PRAGMA foreign_keys=ON');
    db.run(`CREATE TABLE IF NOT EXISTS ai_layout_mappings (
      layout_hash TEXT PRIMARY KEY,
      portal_type TEXT NOT NULL,
      mapping_rules TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  });
  return db;
}

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

let txQueue = Promise.resolve();

function runTransaction(fn) {
  return new Promise((resolve, reject) => {
    const _db = getDb();
    txQueue = txQueue.then(() => {
      return new Promise((res, rej) => {
        _db.run('BEGIN IMMEDIATE', (beginErr) => {
          if (beginErr) return rej(beginErr);
          
          const txQuery = (sql, params = []) => new Promise((qRes, qRej) => {
            _db.all(sql, params, (err, rows) => err ? qRej(err) : qRes(rows || []));
          });
          const txRun = (sql, params = []) => new Promise((rRes, rRej) => {
            _db.run(sql, params, function(err) { err ? rRej(err) : rRes({ lastID: this.lastID, changes: this.changes }); });
          });

          fn({ query: txQuery, run: txRun })
            .then((result) => {
              _db.run('COMMIT', (commitErr) => {
                if (commitErr) rej(commitErr);
                else res(result);
              });
            })
            .catch((fnErr) => {
              _db.run('ROLLBACK', () => rej(fnErr));
            });
        });
      });
    }).then(resolve, reject);
  });
}

function checkpoint() {
  return new Promise((resolve, reject) => {
    if (!db) return resolve();
    db.run('PRAGMA wal_checkpoint(TRUNCATE)', (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function close() {
  return new Promise((resolve, reject) => {
    if (!db) return resolve();
    db.close((err) => {
      if (err) reject(err);
      else {
        db = null;
        resolve();
      }
    });
  });
}

/**
 * Reopen the database connection — used by the restore flow.
 * Closes existing connection (nulling `db`), then calls getDb() to re-initialise.
 */
async function reopen() {
  await close();
  getDb(); // triggers reconnect and PRAGMA setup
}

module.exports = { query, run, close, reopen, getDb, runTransaction, checkpoint, dbPath };
