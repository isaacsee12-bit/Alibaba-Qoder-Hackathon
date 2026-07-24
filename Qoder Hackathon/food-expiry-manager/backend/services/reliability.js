/**
 * services/reliability.js — the reliability bot.
 *
 * Validates new items and periodically scans the inventory for problems,
 * recording reliability_flags. Flag types are constrained by the schema to
 * ('low_confidence', 'expiry_mismatch', 'unknown_food', 'expired'), so:
 *   - duplicate active items are recorded as 'low_confidence' with an
 *     explanatory detail
 *   - impossible dates (expires_at < added_at) are recorded as
 *     'expiry_mismatch' with an explanatory detail
 * Scans are idempotent: unresolved flags of the same type for the same item
 * are never duplicated.
 */
const db = require('../db/db');
const shelfLife = require('./shelfLife');

const DAY_MS = 24 * 60 * 60 * 1000;

function flagToApi(row) {
  return {
    id: row.id,
    itemId: row.item_id,
    flagType: row.flag_type,
    detail: row.detail,
    resolved: !!row.resolved,
    createdAt: row.created_at,
  };
}

function hasUnresolvedFlag(itemId, flagType) {
  return !!db.get(
    'SELECT id FROM reliability_flags WHERE item_id = ? AND flag_type = ? AND resolved = 0',
    [itemId, flagType]
  );
}

/** Create a flag unless the same unresolved flag already exists. */
function createFlag(itemId, flagType, detail) {
  if (hasUnresolvedFlag(itemId, flagType)) return null;
  const result = db.run(
    'INSERT INTO reliability_flags (item_id, flag_type, detail, resolved, created_at) VALUES (?, ?, ?, 0, ?)',
    [itemId, flagType, detail, new Date().toISOString()]
  );
  return flagToApi(db.get('SELECT * FROM reliability_flags WHERE id = ?', [result.lastInsertRowid]));
}

/**
 * Validate a freshly created item (API shape). Returns the flags created.
 * @param {object} item camelCase item as returned by inventory.getById
 */
function validateOnCreate(item) {
  const flags = [];

  // confidence check: >=0.7, null, or manual entry are fine
  const conf = item.confidence;
  if (conf !== null && conf !== undefined && item.source !== 'manual' && conf < 0.7) {
    if (conf >= 0.4) {
      const f = createFlag(item.id, 'low_confidence', `Recognition confidence is ${conf.toFixed(2)} — please confirm this item.`);
      if (f) flags.push(f);
    } else {
      const f = createFlag(item.id, 'low_confidence', `Very low recognition confidence (${conf.toFixed(2)}) — this item may be wrong.`);
      if (f) flags.push(f);
    }
  }

  // unknown food check — for unknown_food flags, only the suggested closest
  // match may appear in quotes (the frontend parses quoted text / "did you
  // mean" phrasing to offer an "Apply suggested name" action)
  const match = shelfLife.findMatch(item.name);
  if (!match) {
    const f = createFlag(item.id, 'unknown_food', `${item.name} is not in the reference food list; no close match found.`);
    if (f) flags.push(f);
  } else if (match.matchType === 'levenshtein' || match.matchType === 'substring') {
    // matched only loosely — surface the suggestion without blocking
    const norm = shelfLife.normalize(item.name);
    if (norm !== shelfLife.normalize(match.matchedName) && match.matchType === 'levenshtein') {
      const f = createFlag(item.id, 'unknown_food', `${item.name} is not an exact match — did you mean "${match.matchedName}"?`);
      if (f) flags.push(f);
    }
  }

  // expiry plausibility: provided date should be within 0.5x–2x of reference shelf life
  if (item.expiresAt && item.addedAt && match) {
    const days = (new Date(item.expiresAt) - new Date(item.addedAt)) / DAY_MS;
    const ref = match.entry.fridgeDays;
    if (ref > 0 && (days < 0.5 * ref || days > 2 * ref)) {
      const f = createFlag(
        item.id,
        'expiry_mismatch',
        `Expiry in ${days.toFixed(1)} days, but "${match.matchedName}" typically lasts ~${ref} days in the fridge (expected ${(0.5 * ref).toFixed(1)}–${2 * ref} days).`
      );
      if (f) flags.push(f);
    }
  }

  return flags;
}

/**
 * Scan all active items for problems. Idempotent. Returns created flags.
 */
function scan() {
  const now = new Date();
  const active = db.all("SELECT * FROM items WHERE status = 'active'");
  const created = [];

  // 1. already-expired active items
  for (const row of active) {
    if (row.expires_at && new Date(row.expires_at) < now) {
      const daysAgo = Math.max(0, Math.floor((now - new Date(row.expires_at)) / DAY_MS));
      const f = createFlag(row.id, 'expired', `"${row.name}" expired ${daysAgo === 0 ? 'today' : daysAgo + ' day(s) ago'} — consume or discard it.`);
      if (f) created.push(f);
    }
  }

  // 2. duplicate active items (same normalized name + category)
  const groups = new Map();
  for (const row of active) {
    const key = `${shelfLife.normalize(row.name)}|${row.category || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const rows of groups.values()) {
    if (rows.length > 1) {
      const ids = rows.map((r) => r.id);
      for (const row of rows) {
        const others = ids.filter((id) => id !== row.id);
        const f = createFlag(row.id, 'low_confidence', `Possible duplicate: "${row.name}" (${row.category}) also appears as item(s) #${others.join(', #')}.`);
        if (f) created.push(f);
      }
    }
  }

  // 3. impossible dates: expires before it was added
  for (const row of active) {
    if (row.expires_at && row.added_at && new Date(row.expires_at) < new Date(row.added_at)) {
      const f = createFlag(row.id, 'expiry_mismatch', `Impossible dates: "${row.name}" expires (${row.expires_at}) before it was added (${row.added_at}).`);
      if (f) created.push(f);
    }
  }

  return created;
}

/** Unresolved flags (default) joined with item names, for the API. */
function listFlags(includeResolved = false) {
  const rows = db.all(
    `SELECT f.*, i.name AS item_name FROM reliability_flags f
     LEFT JOIN items i ON i.id = f.item_id
     ${includeResolved ? '' : 'WHERE f.resolved = 0'}
     ORDER BY f.created_at DESC`
  );
  return rows.map((row) => ({ ...flagToApi(row), itemName: row.item_name }));
}

function resolveFlag(id) {
  const row = db.get('SELECT * FROM reliability_flags WHERE id = ?', [id]);
  if (!row) return null;
  db.run('UPDATE reliability_flags SET resolved = 1 WHERE id = ?', [id]);
  return flagToApi(db.get('SELECT * FROM reliability_flags WHERE id = ?', [id]));
}

module.exports = { validateOnCreate, scan, listFlags, resolveFlag, createFlag };
