const { query } = require('./src/core/db');

async function check() {
  try {
    const tables = await query("SELECT name FROM sqlite_master WHERE type='table'");
    console.log("Tables in authz.sqlite:", tables);

    const auth_users = await query(`SELECT * FROM auth_users`);
    console.log(`\nTable auth_users:`, auth_users);
    
    try {
      const users = await query(`SELECT * FROM users`);
      console.log(`\nTable users:`, users);
    } catch(e) {
      console.log('No table "users"');
    }
  } catch(e) {
    console.error(e);
  }
}
check();
