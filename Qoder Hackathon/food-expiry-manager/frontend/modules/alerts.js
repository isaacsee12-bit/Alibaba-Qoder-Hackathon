// Alerts tab: expired items, expiring-soon items + recipe matches, reliability flags.

import { api } from './api.js';
import { toast, refreshAlertBadge } from '../app.js';
import { esc, daysLeftText } from './util.js';

const FLAG_LABELS = {
  low_confidence: { text: 'Low confidence', cls: 'warn' },
  expiry_mismatch: { text: 'Expiry mismatch', cls: 'warn' },
  unknown_food: { text: 'Unknown food', cls: 'neutral' },
  expired: { text: 'Expired', cls: 'danger' },
};

export async function renderAlerts(view) {
  view.innerHTML = `
    <h2>Alerts</h2>
    <div id="alerts-body"><div class="empty-state"><span class="spinner"></span></div></div>
  `;
  await load(view);
}

async function load(view) {
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

  const expired = alerts.expired || [];
  const soon = alerts.expiringSoon || [];

  if (expired.length === 0 && soon.length === 0 && flags.length === 0) {
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

    ${soon.length && recipes.length ? `<h3>🍳 Recipe ideas</h3>` : ''}
    ${recipes.map((r) => `
      <div class="card recipe-card">
        <p class="card-title">${esc(r.title)}</p>
        ${r.usesItems?.length ? `<p class="card-sub">Uses: ${r.usesItems.map((n) => `<span class="chip">${esc(typeof n === 'string' ? n : n.name)}</span>`).join(' ')}</p>` : ''}
        <ul>${(r.ingredients || []).map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
        <p class="muted">${esc(r.instructions || '')}</p>
      </div>`).join('')}

    ${flags.length ? `<h3>🛡 Reliability flags (${flags.length})</h3>` : ''}
    ${flags.map((f) => flagCard(f)).join('')}
  `;

  body.onclick = (e) => onClick(e, view);
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

async function onClick(e, view) {
  const btn = e.target.closest('button');
  if (!btn) return;

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
    await load(view);
    refreshAlertBadge();
  } catch {
    btn.disabled = false;
  }
}
