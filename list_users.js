const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('./data/authz.sqlite');

db.all("SELECT id, name, canonical_phone, subscription_plan, used_count, daily_count, is_active FROM auth_users", (err, rows) => {
  if (err) {
    console.error(err);
  } else {
    console.table(rows);
  }
  db.close();
});
