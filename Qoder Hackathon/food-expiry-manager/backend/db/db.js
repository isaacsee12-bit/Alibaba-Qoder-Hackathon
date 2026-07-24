/**
 * db/db.js — single DB access wrapper.
 *
 * All database access in the app goes through this module so the engine is
 * swappable. Primary engine: better-sqlite3 (synchronous, prepared statements).
 * Fallback (if native install fails): sql.js — reimplement run/get/all/exec
 * here on top of the WASM API and persist the exported buffer to DB_PATH;
 * no other file needs to change.
 */
const path = require('path');

let Database;
try {
  Database = require('better-sqlite3');
} catch (err) {
  throw new Error(
    `Failed to load better-sqlite3 (native module missing or built for another Node version): ${err.message}. ` +
    'Fix: run npm install in backend/ with the current Node version.'
  );
}

// Overridable so the DB can live outside OneDrive (avoids sync file-lock errors).
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'food.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

module.exports = {
  DB_PATH,

  /** Execute a write statement. Returns { changes, lastInsertRowid }. */
  run(sql, params = []) {
    return db.prepare(sql).run(params);
  },

  /** Fetch a single row (or undefined). */
  get(sql, params = []) {
    return db.prepare(sql).get(params);
  },

  /** Fetch all rows. */
  all(sql, params = []) {
    return db.prepare(sql).all(params);
  },

  /** Execute a multi-statement SQL script (no params). */
  exec(sql) {
    db.exec(sql);
  },
};
