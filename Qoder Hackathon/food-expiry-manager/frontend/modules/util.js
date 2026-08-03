// Small shared helpers used across view modules.

/** Escape a string for safe interpolation into HTML. */
export function esc(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Whole days from now until the given ISO date (negative = past). */
export function daysUntil(isoDate) {
  if (!isoDate) return null;
  const now = new Date();
  const target = new Date(isoDate);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((startOfTarget - startOfToday) / 86400000);
}

/** Bucket an item into 'expired' | 'soon' | 'fresh' by its expiresAt.
 * 'soon' covers the next 5 days (shared with the Inventory page filter tabs). */
export function urgencyOf(item) {
  const d = daysUntil(item.expiresAt);
  if (d === null) return 'fresh';
  if (d < 0) return 'expired';
  if (d <= 5) return 'soon';
  return 'fresh';
}

/** Human "expired 2 days ago" / "expires today" / "3 days left" text. */
export function daysLeftText(isoDate) {
  const d = daysUntil(isoDate);
  if (d === null) return 'No expiry set';
  if (d < 0) return `Expired ${-d} day${d === -1 ? '' : 's'} ago`;
  if (d === 0) return 'Expires today';
  if (d === 1) return 'Expires tomorrow';
  return `${d} days left`;
}

/** yyyy-mm-dd for <input type="date"> from an ISO string. */
export function toDateInputValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const CATEGORIES = ['fruit', 'vegetable', 'dairy', 'meat', 'grain', 'seafood', 'snack', 'beverage', 'other'];

/** Options markup for a category <select>. */
export function categoryOptions(selected) {
  return CATEGORIES.map(
    (c) => `<option value="${c}" ${c === selected ? 'selected' : ''}>${c[0].toUpperCase()}${c.slice(1)}</option>`
  ).join('');
}
