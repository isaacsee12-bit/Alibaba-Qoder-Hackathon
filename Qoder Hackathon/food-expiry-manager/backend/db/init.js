/**
 * db/init.js — applies the schema on startup (idempotent, CREATE IF NOT EXISTS).
 */
const fs = require('fs');
const path = require('path');
const db = require('./db');

function init() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
}

module.exports = { init };
