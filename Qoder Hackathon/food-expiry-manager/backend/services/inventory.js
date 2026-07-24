/**
 * services/inventory.js — item CRUD + consume/discard.
 * DB rows are snake_case; the API shape is camelCase (mapped here).
 */
const db = require('../db/db');

/** Map a DB row to the API item shape (camelCase, parsed nutrition). */
function rowToItem(row) {
  if (!row) return null;
  let nutrition = null;
  if (row.nutrition_json) {
    try { nutrition = JSON.parse(row.nutrition_json); } catch { nutrition = null; }
  }
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    quantity: row.quantity,
    unit: row.unit,
    addedAt: row.added_at,
    expiresAt: row.expires_at,
    status: row.status,
    source: row.source,
    confidence: row.confidence,
    photoPath: row.photo_path,
    nutrition,
  };
}

function list(status = 'active') {
  const rows = status === 'all'
    ? db.all('SELECT * FROM items ORDER BY expires_at ASC')
    : db.all('SELECT * FROM items WHERE status = ? ORDER BY expires_at ASC', [status]);
  return rows.map(rowToItem);
}

function getById(id) {
  return rowToItem(db.get('SELECT * FROM items WHERE id = ?', [id]));
}

function create(fields) {
  const result = db.run(
    `INSERT INTO items (name, category, quantity, unit, added_at, expires_at, status, source, confidence, photo_path, nutrition_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fields.name,
      fields.category ?? null,
      fields.quantity ?? null,
      fields.unit ?? null,
      fields.addedAt ?? new Date().toISOString(),
      fields.expiresAt ?? null,
      fields.status ?? 'active',
      fields.source ?? 'manual',
      fields.confidence ?? null,
      fields.photoPath ?? null,
      fields.nutrition ? JSON.stringify(fields.nutrition) : null,
    ]
  );
  return getById(result.lastInsertRowid);
}

const COLUMN_MAP = {
  name: 'name',
  category: 'category',
  quantity: 'quantity',
  unit: 'unit',
  addedAt: 'added_at',
  expiresAt: 'expires_at',
  status: 'status',
  source: 'source',
  confidence: 'confidence',
  photoPath: 'photo_path',
};

function update(id, fields) {
  const existing = getById(id);
  if (!existing) return null;

  const sets = [];
  const params = [];
  for (const [key, column] of Object.entries(COLUMN_MAP)) {
    if (fields[key] !== undefined) {
      sets.push(`${column} = ?`);
      params.push(fields[key]);
    }
  }
  if (fields.nutrition !== undefined) {
    sets.push('nutrition_json = ?');
    params.push(fields.nutrition === null ? null : JSON.stringify(fields.nutrition));
  }
  if (sets.length) {
    params.push(id);
    db.run(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`, params);
  }
  return getById(id);
}

function remove(id) {
  const existing = getById(id);
  if (!existing) return false;
  db.run('DELETE FROM reliability_flags WHERE item_id = ?', [id]);
  db.run('DELETE FROM consumption_log WHERE item_id = ?', [id]);
  db.run('DELETE FROM items WHERE id = ?', [id]);
  return true;
}

/** Mark item consumed/discarded and append to consumption_log. */
function logAction(id, action) {
  const existing = getById(id);
  if (!existing) return null;
  db.run('UPDATE items SET status = ? WHERE id = ?', [action, id]);
  db.run('INSERT INTO consumption_log (item_id, action, at) VALUES (?, ?, ?)', [id, action, new Date().toISOString()]);
  return getById(id);
}

module.exports = { rowToItem, list, getById, create, update, remove, logAction };
