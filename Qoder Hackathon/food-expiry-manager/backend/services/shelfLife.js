/**
 * services/shelfLife.js — reference shelf-life lookup with fuzzy name matching.
 *
 * Match cascade: case-insensitive exact → singular/plural variants →
 * substring containment → Levenshtein distance ≤ 2.
 */
const path = require('path');
const shelfLife = require(path.join(__dirname, '..', 'data', 'shelf_life.json'));
const nutrition = require(path.join(__dirname, '..', 'data', 'nutrition.json'));

const DEFAULT_FRIDGE_DAYS = 7; // fallback when a food is completely unknown

function normalize(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Singular/plural variants of a normalized name. */
function variants(name) {
  const v = new Set([name]);
  if (name.endsWith('ies')) v.add(name.slice(0, -3) + 'y');
  if (name.endsWith('es')) v.add(name.slice(0, -2));
  if (name.endsWith('s')) v.add(name.slice(0, -1));
  if (name.endsWith('y')) v.add(name.slice(0, -1) + 'ies');
  v.add(name + 's');
  v.add(name + 'es');
  return [...v];
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[n];
}

/**
 * Find the reference entry for a food name.
 * @returns {{ entry, matchedName, matchType } | null}
 */
function findMatch(rawName) {
  const name = normalize(rawName);
  if (!name) return null;

  // 1. case-insensitive exact
  for (const entry of shelfLife) {
    if (normalize(entry.name) === name) return { entry, matchedName: entry.name, matchType: 'exact' };
  }

  // 2. singular/plural variants
  const nameVariants = variants(name);
  for (const entry of shelfLife) {
    const refVariants = variants(normalize(entry.name));
    if (nameVariants.some((v) => refVariants.includes(v))) {
      return { entry, matchedName: entry.name, matchType: 'plural' };
    }
  }

  // 3. substring containment (either direction), prefer longest reference name
  let substringHit = null;
  for (const entry of shelfLife) {
    const ref = normalize(entry.name);
    if (name.includes(ref) || ref.includes(name)) {
      if (!substringHit || ref.length > normalize(substringHit.name).length) substringHit = entry;
    }
  }
  if (substringHit) return { entry: substringHit, matchedName: substringHit.name, matchType: 'substring' };

  // 4. Levenshtein distance ≤ 2
  let best = null;
  let bestDist = 3;
  for (const entry of shelfLife) {
    const dist = levenshtein(name, normalize(entry.name));
    if (dist < bestDist) {
      bestDist = dist;
      best = entry;
    }
  }
  if (best) return { entry: best, matchedName: best.name, matchType: 'levenshtein' };

  return null;
}

/**
 * Estimate an expiry date for a food (default: fridge storage).
 * @returns {{ expiresAt, matchedName|null, fridgeDays, matched: boolean }}
 */
function estimateExpiry(rawName, fromISO) {
  const from = fromISO ? new Date(fromISO) : new Date();
  const match = findMatch(rawName);
  const days = match ? match.entry.fridgeDays : DEFAULT_FRIDGE_DAYS;
  const expires = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  return {
    expiresAt: expires.toISOString(),
    matchedName: match ? match.matchedName : null,
    fridgeDays: days,
    matched: !!match,
  };
}

/** Nutrition record for a food (fuzzy matched), or null. */
function getNutrition(rawName) {
  const match = findMatch(rawName);
  if (!match) return null;
  return nutrition[match.matchedName] || null;
}

module.exports = { findMatch, estimateExpiry, getNutrition, normalize, DEFAULT_FRIDGE_DAYS };
