/**
 * db/seed.js — demo data seeding.
 *
 * Seeds 15 demo items on first run. Each reseed rotates to a different curated
 * inventory while preserving expired, expiring-soon, and fresh examples.
 */
const db = require('./db');
const shelfLife = require('../services/shelfLife');
const { DEMO_SETS, nextDemoSet } = require('../data/demo_sets');

const DAY_MS = 24 * 60 * 60 * 1000;

function buildDemoRows(items = DEMO_SETS[0], now = new Date()) {
  return items.map(([name, category, quantity, unit, addedDaysAgo, expiresInDays]) => {
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
  return insertRows(buildDemoRows(DEMO_SETS[0]));
}

/** Delete demo items and rotate to a guaranteed-different curated set. */
function reseed() {
  const current = db.all("SELECT id, name FROM items WHERE source = 'demo'");
  const nextSet = nextDemoSet(current.map((row) => row.name));

  for (const { id } of current) {
    db.run('DELETE FROM reliability_flags WHERE item_id = ?', [id]);
    db.run('DELETE FROM consumption_log WHERE item_id = ?', [id]);
    db.run('DELETE FROM items WHERE id = ?', [id]);
  }

  return insertRows(buildDemoRows(nextSet));
}

module.exports = { seedIfEmpty, reseed };
