// Alerts tab: expiry alerts (expired, expiring soon, reliability flags) and recipe alerts,
// with filter tabs, most-recent-first ordering and favourite recipes.

import { api } from './api.js';
import { toast, refreshAlertBadge } from '../app.js';
import { esc, daysLeftText } from './util.js';

const FLAG_LABELS = {
  low_confidence: { text: 'Low confidence', cls: 'warn' },
  expiry_mismatch: { text: 'Expiry mismatch', cls: 'warn' },
  unknown_food: { text: 'Unknown food', cls: 'neutral' },
  expired: { text: 'Expired', cls: 'danger' },
};

const TABS = [
  { key: 'expiry', label: 'Food Expiry' },
  { key: 'recipe', label: 'Recipe' },
];

const FAV_STORAGE_KEY = 'fem.favRecipes';
const SEEN_STORAGE_KEY = 'fem.recipeFirstSeen';

// ---------- favourites & first-seen persistence (localStorage) ----------

function loadFavs() {
  try { return JSON.parse(localStorage.getItem(FAV_STORAGE_KEY) || '[]'); } catch { return []; }
}
function saveFavs(favs) {
  try { localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify(favs)); } catch { /* storage unavailable */ }
}
function isFav(title) { return loadFavs().includes(title); }
function toggleFav(title) {
  const favs = loadFavs();
  const idx = favs.indexOf(title);
  if (idx === -1) favs.push(title);
  else favs.splice(idx, 1);
  saveFavs(favs);
}

function loadSeen() {
  try { return JSON.parse(localStorage.getItem(SEEN_STORAGE_KEY) || '{}'); } catch { return {}; }
}
function saveSeen(seen) {
  try { localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(seen)); } catch { /* storage unavailable */ }
}

// ---------- sorting ----------

/** Most recently added/created first; entries without a timestamp go last. */
function byTimestampDesc(a, b) {
  const ta = a.addedAt || a.createdAt || '';
  const tb = b.addedAt || b.createdAt || '';
  if (!ta && !tb) return 0;
  if (!ta) return 1;
  if (!tb) return -1;
  return new Date(tb) - new Date(ta);
}

/** Recipes sorted: favourites first, then most recently seen first. */
function sortedRecipes(recipes) {
  const seen = loadSeen();
  const now = new Date().toISOString();
  let changed = false;
  const stamped = recipes.map((r) => {
    if (!seen[r.title]) { seen[r.title] = now; changed = true; }
    return { recipe: r, seenAt: seen[r.title], fav: isFav(r.title) };
  });
  if (changed) saveSeen(seen);
  return stamped.sort((a, b) => {
    if (a.fav !== b.fav) return a.fav ? -1 : 1;
    return new Date(b.seenAt) - new Date(a.seenAt);
  });
}

// ---------- page ----------

export async function renderAlerts(view) {
  const state = { tab: 'expiry', data: null };

  view.innerHTML = `
    <h2>Alerts</h2>
    <div class="alerts-tabs" role="group" aria-label="Filter alerts">
      ${TABS.map((t) => `<button type="button" class="alerts-tab${t.key === state.tab ? ' active' : ''}" data-tab="${t.key}">${t.label}</button>`).join('')}
    </div>
    <div id="alerts-body"><div class="empty-state"><span class="spinner"></span></div></div>
  `;

  view.querySelectorAll('.alerts-tab').forEach((button) => {
    button.addEventListener('click', () => {
      state.tab = button.dataset.tab;
      view.querySelectorAll('.alerts-tab').forEach((b) => b.classList.toggle('active', b === button));
      render(view, state);
    });
  });

  await load(view, state);
}

async function load(view, state) {
  const body = view.querySelector('#alerts-body');
  let alerts = { expired: [], expiringSoon: [] };
  let recipes = [];
  let flags = [];
  let reachable = true;

  try {
    alerts = await api.getAlerts({ silent: true });
  } catch { reachable = false; }
  try {
    const rec = await api.getRecommendations({ silent: true });
    recipes = rec.recipes || [];
  } catch { /* recipes optional */ }
  try {
    const fl = await api.getReliabilityFlags({ silent: true });
    flags = (fl.flags || []).filter((f) => !f.resolved);
  } catch { /* flags optional */ }

  if (!reachable) {
    body.innerHTML = `<div class="empty-state"><span class="emoji">📡</span>Couldn't load alerts.<br>Check that the server is running.</div>`;
    return;
  }

  state.data = { alerts, recipes, flags };
  render(view, state);
}

function render(view, state) {
  const body = view.querySelector('#alerts-body');
  if (!state.data) return;

  if (state.tab === 'recipe') renderRecipes(body, state.data.recipes);
  else renderExpiry(body, state.data.alerts, state.data.flags);

  body.onclick = (e) => onClick(e, view, state);
}

function renderExpiry(body, alerts, flags) {
  const expired = (alerts.expired || []).slice().sort(byTimestampDesc);
  const soon = (alerts.expiringSoon || []).slice().sort(byTimestampDesc);
  const flagList = (flags || []).slice().sort(byTimestampDesc);

  if (expired.length === 0 && soon.length === 0 && flagList.length === 0) {
    body.innerHTML = `<div class="empty-state"><span class="emoji">🎉</span>All clear — nothing expiring and no flags!</div>`;
    return;
  }

  body.innerHTML = `
    ${expired.length ? `<h3>🚨 Expired (${expired.length})</h3>` : ''}
    ${expired.map((item) => `
      <div class="card urgency-expired" data-item-id="${esc(item.id)}">
        <div class="section-head">
          <p class="card-title" style="text-transform:capitalize">${esc(item.name)}</p>
          <span class="days-left expired">${daysLeftText(item.expiresAt)}</span>
        </div>
        <p class="card-sub">This item is past its expiry — consider discarding it.</p>
        <div class="item-actions">
          <button class="btn btn-sm btn-danger" data-discard="${esc(item.id)}">🗑 Discard now</button>
        </div>
      </div>`).join('')}

    ${soon.length ? `<h3>⏳ Expiring soon (${soon.length})</h3>` : ''}
    ${soon.map((item) => `
      <div class="card urgency-soon">
        <div class="section-head">
          <p class="card-title" style="text-transform:capitalize">${esc(item.name)}</p>
          <span class="days-left soon">${daysLeftText(item.expiresAt)}</span>
        </div>
        <p class="card-sub">Use it up soon — recipe ideas below.</p>
      </div>`).join('')}

    ${flagList.length ? `<h3>🛡 Reliability flags (${flagList.length})</h3>` : ''}
    ${flagList.map((f) => flagCard(f)).join('')}
  `;
}

function renderRecipes(body, recipes) {
  if (!recipes.length) {
    body.innerHTML = `<div class="empty-state"><span class="emoji">🍳</span>No recipe ideas right now.<br>Items expiring soon unlock recipe suggestions.</div>`;
    return;
  }

  const sorted = sortedRecipes(recipes);
  body.innerHTML = `
    <h3>🍳 Recipe ideas</h3>
    ${sorted.map(({ recipe, fav }) => recipeCard(recipe, fav)).join('')}
  `;
}

function recipeCard(r, fav) {
  return `
    <div class="card recipe-card${fav ? ' fav' : ''}">
      <div class="section-head">
        <p class="card-title">${esc(r.title)}</p>
        <button type="button" class="btn btn-sm fav-toggle${fav ? ' faved' : ''}" data-fav="${esc(r.title)}" aria-pressed="${fav}">${fav ? '★ Favourited' : '☆ Favourite'}</button>
      </div>
      ${r.usesItems?.length ? `<p class="card-sub">Uses: ${r.usesItems.map((n) => `<span class="chip">${esc(typeof n === 'string' ? n : n.name)}</span>`).join(' ')}</p>` : ''}
      <ul>${(r.ingredients || []).map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
      <p class="muted">${esc(r.instructions || '')}</p>
    </div>
  `;
}

function flagCard(flag) {
  const meta = FLAG_LABELS[flag.flagType] || { text: flag.flagType, cls: 'neutral' };
  const suggestion = flag.flagType === 'unknown_food' ? extractSuggestion(flag.detail) : null;
  return `
    <div class="card" data-flag-id="${esc(flag.id)}" data-flag-item="${esc(flag.itemId ?? '')}">
      <div class="section-head">
        <p class="card-title">${esc(flag.itemName || 'Item')}</p>
        <span class="chip ${meta.cls}">${esc(meta.text)}</span>
      </div>
      <p class="card-sub">${esc(flag.detail || '')}</p>
      <div class="item-actions">
        <button class="btn btn-sm btn-primary" data-resolve="${esc(flag.id)}">✓ Resolve</button>
        ${suggestion ? `<button class="btn btn-sm" data-apply-name="${esc(suggestion)}">Apply "${esc(suggestion)}"</button>` : ''}
        ${flag.flagType === 'expired' && flag.itemId != null ? `<button class="btn btn-sm btn-danger" data-flag-discard="${esc(flag.itemId)}">🗑 Discard item</button>` : ''}
      </div>
    </div>
  `;
}

/** Pull a suggested name out of flag detail text like `... suggested: "banana"` or 'Did you mean banana?'. */
function extractSuggestion(detail = '') {
  const quoted = detail.match(/["'“”]([^"'“”]{2,40})["'“”]/);
  if (quoted) return quoted[1];
  const meanMatch = detail.match(/(?:suggest(?:ed|ion)?|did you mean|maybe|possibly)[:\s]+([a-z][a-z\s-]{1,30})/i);
  if (meanMatch) return meanMatch[1].trim().replace(/[.?!]$/, '');
  return null;
}

async function onClick(e, view, state) {
  const btn = e.target.closest('button');
  if (!btn) return;

  if (btn.dataset.fav !== undefined) {
    toggleFav(btn.dataset.fav);
    render(view, state);
    return;
  }

  try {
    if (btn.dataset.discard || btn.dataset.flagDiscard) {
      btn.disabled = true;
      await api.discardItem(btn.dataset.discard || btn.dataset.flagDiscard);
      toast('Item discarded.', 'success');
    } else if (btn.dataset.resolve) {
      btn.disabled = true;
      await api.resolveFlag(btn.dataset.resolve);
      toast('Flag resolved.', 'success');
    } else if (btn.dataset.applyName !== undefined) {
      const card = btn.closest('.card[data-flag-id]');
      const itemId = card.dataset.flagItem;
      if (!itemId) { toast('No item linked to this flag.', 'error'); return; }
      btn.disabled = true;
      await api.updateItem(itemId, { name: btn.dataset.applyName });
      await api.resolveFlag(card.dataset.flagId, { silent: true }).catch(() => {});
      toast(`Renamed to "${btn.dataset.applyName}".`, 'success');
    } else {
      return;
    }
    await load(view, state);
    refreshAlertBadge();
  } catch {
    btn.disabled = false;
  }
}
