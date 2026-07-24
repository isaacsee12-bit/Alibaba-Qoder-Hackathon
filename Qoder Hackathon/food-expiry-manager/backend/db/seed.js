/**
 * db/seed.js — demo data seeding.
 *
 * Seeds ~15 demo items (source 'demo') on first run (empty items table),
 * covering all urgency states: 3 already expired, 4 expiring in 1–3 days,
 * 8 fresh — spread across categories. reseed() removes demo items and
 * seeds them again.
 */
const db = require('./db');
const shelfLife = require('../services/shelfLife');

const DAY_MS = 24 * 60 * 60 * 1000;

// [name, category, quantity, unit, addedDaysAgo, expiresInDays]
const DEMO_ITEMS = [
  // 3 already expired
  ['milk', 'dairy', 1, 'liter', 8, -2],
  ['spinach', 'vegetable', 200, 'g', 6, -1],
  ['chicken breast', 'meat', 500, 'g', 5, -3],
  // 4 expiring in 1–3 days
  ['banana', 'fruit', 5, 'pcs', 4, 2],
  ['lettuce', 'vegetable', 1, 'head', 5, 2],
  ['salmon', 'seafood', 300, 'g', 1, 1],
  ['tomato', 'vegetable', 4, 'pcs', 4, 3],
  // 8 fresh
  ['eggs', 'dairy', 12, 'pcs', 2, 30],
  ['cheddar cheese', 'dairy', 250, 'g', 3, 25],
  ['apple', 'fruit', 6, 'pcs', 1, 20],
  ['carrot', 'vegetable', 500, 'g', 2, 14],
  ['orange juice', 'beverage', 1, 'liter', 1, 6],
  ['white rice', 'grain', 2, 'kg', 10, 300],
  ['pasta', 'grain', 500, 'g', 10, 400],
  ['frozen peas', 'frozen', 400, 'g', 7, 180],
];

function buildDemoRows(now = new Date()) {
  return DEMO_ITEMS.map(([name, category, quantity, unit, addedDaysAgo, expiresInDays]) => {
    const nutrition = shelfLife.getNutrition(name);
    return {
      name,
      category,
      quantity,
      unit,
      added_at: new Date(now.getTime() - addedDaysAgo * DAY_MS).toISOString(),
      expires_at: new Date(now.getTime() + expiresInDays * DAY_MS).toISOString(),
      status: 'active',
      source: 'demo',
      confidence: null,
      photo_path: null,
      nutrition_json: nutrition ? JSON.stringify(nutrition) : null,
    };
  });
}

function insertRows(rows) {
  for (const r of rows) {
    db.run(
      `INSERT INTO items (name, category, quantity, unit, added_at, expires_at, status, source, confidence, photo_path, nutrition_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.name, r.category, r.quantity, r.unit, r.added_at, r.expires_at, r.status, r.source, r.confidence, r.photo_path, r.nutrition_json]
    );
  }
  return rows.length;
}

/** Seed demo items only when the items table is empty. Returns count seeded. */
function seedIfEmpty() {
  const { n } = db.get('SELECT COUNT(*) AS n FROM items');
  if (n > 0) return 0;
  return insertRows(buildDemoRows());
}

/** Delete demo items (and their flags/logs) and seed fresh ones. */
function reseed() {
  const demoIds = db.all("SELECT id FROM items WHERE source = 'demo'").map((r) => r.id);
  for (const id of demoIds) {
    db.run('DELETE FROM reliability_flags WHERE item_id = ?', [id]);
    db.run('DELETE FROM consumption_log WHERE item_id = ?', [id]);
    db.run('DELETE FROM items WHERE id = ?', [id]);
  }
  return insertRows(buildDemoRows());
}

module.exports = { seedIfEmpty, reseed };
