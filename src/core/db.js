// Compatibility wrapper for legacy src services.
// All runtime database access must go through the shared PostgreSQL module.
module.exports = require('../../packages/common/src/db');
