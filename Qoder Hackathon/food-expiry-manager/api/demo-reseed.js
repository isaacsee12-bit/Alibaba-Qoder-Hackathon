const { createClient } = require('@libsql/client');
const nutritionData = require('../backend/data/nutrition.json');
const { nextDemoSet } = require('../backend/data/demo_sets');

const DAY_MS = 86400000;

function normalize(value = '') {
  return String(value).toLowerCase().trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });

  try {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    if (!url) throw new Error('TURSO_DATABASE_URL is not configured');

    const db = createClient({ url, authToken });
    const currentResult = await db.execute("SELECT id, name FROM items WHERE source='demo'");
    const current = currentResult.rows;
    const nextSet = nextDemoSet(current.map((row) => row.name));

    for (const row of current) {
      await db.execute({ sql: 'DELETE FROM reliability_flags WHERE item_id=?', args: [row.id] });
      await db.execute({ sql: 'DELETE FROM consumption_log WHERE item_id=?', args: [row.id] });
      await db.execute({ sql: 'DELETE FROM items WHERE id=?', args: [row.id] });
    }

    const now = Date.now();
    for (const [name, category, quantity, unit, addedAgo, expiresIn] of nextSet) {
      const nutrition = nutritionData[normalize(name)] || null;
      await db.execute({
        sql: `INSERT INTO items (name,category,quantity,unit,added_at,expires_at,status,source,confidence,photo_path,nutrition_json)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        args: [
          name,
          category,
          quantity,
          unit,
          new Date(now - addedAgo * DAY_MS).toISOString(),
          new Date(now + expiresIn * DAY_MS).toISOString(),
          'active',
          'demo',
          null,
          null,
          nutrition ? JSON.stringify(nutrition) : null,
        ],
      });
    }

    return json(res, 200, { seeded: nextSet.length, firstItem: nextSet[0][0] });
  } catch (err) {
    console.error(err);
    return json(res, 500, { error: err.message || 'internal server error' });
  }
};
