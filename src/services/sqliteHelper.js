const fs = require('fs');
const sqlite3 = require('sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, '../../data/authorized_entities.db');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);

function initDb() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(
        'CREATE TABLE IF NOT EXISTS authorized_entities (id TEXT PRIMARY KEY, channel TEXT, type TEXT, value TEXT)',
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  });
}

function getAll() {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM authorized_entities', (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function clearAll() {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM authorized_entities', (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function insertEntry(id, channel, type, value) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT OR REPLACE INTO authorized_entities (id, channel, type, value) VALUES (?, ?, ?, ?)',
      [id, channel, type, value],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

const command = process.argv[2];
if (command === 'read') {
  initDb()
    .then(() => getAll())
    .then((rows) => {
      console.log(JSON.stringify(rows));
      db.close();
    })
    .catch((err) => {
      console.error(err);
      db.close();
      process.exit(1);
    });
} else if (command === 'write') {
  let input = '';
  process.stdin.on('data', (chunk) => {
    input += chunk;
  });
  process.stdin.on('end', () => {
    const data = JSON.parse(input);
    initDb()
      .then(() => clearAll())
      .then(async () => {
        if (data.whatsapp && typeof data.whatsapp === 'object') {
          for (const v of data.whatsapp.users || []) {
            await insertEntry('wa_user_' + v, 'wa', 'user', v);
          }
          for (const v of data.whatsapp.groups || []) {
            await insertEntry('wa_group_' + v, 'wa', 'group', v);
          }
          for (const v of data.whatsapp.admins || []) {
            await insertEntry('wa_admin_' + v, 'wa', 'admin', v);
          }
        }
        if (data.telegram && typeof data.telegram === 'object') {
          for (const v of data.telegram.users || []) {
            await insertEntry('tg_user_' + v, 'tg', 'user', v);
          }
          for (const v of data.telegram.groups || []) {
            await insertEntry('tg_group_' + v, 'tg', 'group', v);
          }
          for (const v of data.telegram.admins || []) {
            await insertEntry('tg_admin_' + v, 'tg', 'admin', v);
          }
        }
        db.close();
      })
      .catch((err) => {
        console.error(err);
        db.close();
        process.exit(1);
      });
  });
}
