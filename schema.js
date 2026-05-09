const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('./data/authz.sqlite');

db.serialize(() => {
  db.all("SELECT name, sql FROM sqlite_master WHERE type='table'", (err, rows) => {
    if (err) console.error(err);
    else console.log(rows);
  });
});
