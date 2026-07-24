// Deterministic fallback classifier: FNV-1a hash of image bytes → fixed food list.
// Same image bytes always yield the same {name, confidence}.

const FOODS = [
  { name: 'banana', category: 'fruit', shelfDays: 5 },
  { name: 'apple', category: 'fruit', shelfDays: 14 },
  { name: 'milk', category: 'dairy', shelfDays: 7 },
  { name: 'bread', category: 'grain', shelfDays: 4 },
  { name: 'eggs', category: 'other', shelfDays: 21 },
  { name: 'tomato', category: 'vegetable', shelfDays: 6 },
  { name: 'chicken breast', category: 'meat', shelfDays: 2 },
  { name: 'cheese', category: 'dairy', shelfDays: 14 },
  { name: 'carrot', category: 'vegetable', shelfDays: 21 },
  { name: 'yogurt', category: 'dairy', shelfDays: 10 },
];

function fnv1a(bytes) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Classify an image blob deterministically.
 * @param {Blob} blob
 * @returns {Promise<{name, category, confidence, shelfDays, source}>}
 */
export async function mockClassify(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const hash = fnv1a(buf);
  const food = FOODS[hash % FOODS.length];
  // pseudo-confidence 0.75–0.95 derived from a different slice of the hash
  const confidence = 0.75 + ((hash >>> 8) % 2001) / 10000;
  return {
    name: food.name,
    category: food.category,
    shelfDays: food.shelfDays,
    confidence: Math.round(confidence * 100) / 100,
    source: 'mock',
  };
}
