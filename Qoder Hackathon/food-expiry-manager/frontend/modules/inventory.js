// Inventory tab: searchable, filterable list of active items grouped by urgency.
// Search and filter state are applied client-side so the list updates without a refresh.

import { api } from './api.js';
import { toast, refreshAlertBadge } from '../app.js';
import { esc, urgencyOf, daysLeftText, toDateInputValue, categoryOptions, showConfirmModal } from './util.js';

const GROUPS = [
  { key: 'expired', title: 'Expired', emoji: '🚨' },
  { key: 'soon', title: 'Expiring soon', emoji: '⏳' },
  { key: 'fresh', title: 'Fresh', emoji: '🥬' },
];

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'expired', label: 'Expired' },
  { key: 'soon', label: 'Expiring Soon' },
  { key: 'fresh', label: 'Fresh' },
];

// Last fetched items; search/filter render from this without re-fetching.
let itemsCache = [];

export async function renderInventory(view) {
  const state = { filter: 'all', query: '' };

  view.innerHTML = `
    <div class="section-head">
      <h2>Inventory</h2>
      <button class="btn btn-sm" id="inv-refresh">↻ Refresh</button>
    </div>
    <input type="search" id="inv-search" class="inv-search" placeholder="Search items by name…" aria-label="Search inventory">
    <div class="inv-filters" role="group" aria-label="Filter inventory">
      ${FILTERS.map((f) => `<button type="button" class="inv-filter${f.key === 'all' ? ' active' : ''}" data-filter="${f.key}">${f.label}</button>`).join('')}
    </div>
    <div id="inv-list"><div class="empty-state"><span class="spinner"></span></div></div>
  `;

  view.querySelector('#inv-refresh').addEventListener('click', () => loadList(view, state));

  const searchInput = view.querySelector('#inv-search');
  searchInput.addEventListener('input', () => {
    state.query = searchInput.value;
    renderList(view, state);
  });

  const filterButtons = view.querySelectorAll('.inv-filter');
  filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      state.filter = button.dataset.filter;
      filterButtons.forEach((b) => b.classList.toggle('active', b === button));
      renderList(view, state);
    });
  });

  await loadList(view, state);
}

async function loadList(view, state) {
  const listEl = view.querySelector('#inv-list');
  try {
    const data = await api.getItems('active');
    itemsCache = data.items || [];
  } catch {
    listEl.innerHTML = `<div class="empty-state"><span class="emoji">📡</span>Couldn't load your inventory.<br>Check that the server is running, then refresh.</div>`;
    return;
  }
  renderList(view, state);
}

/** Render the cached items through the active search query + filter tab. */
function renderList(view, state) {
  const listEl = view.querySelector('#inv-list');
  const items = itemsCache;

  if (items.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><span class="emoji">🧺</span>Your inventory is empty.<br>Scan or add some food from the Scan tab!</div>`;
    return;
  }

  // Combine the case-insensitive name search with the selected filter.
  const q = state.query.trim().toLowerCase();
  const visible = items.filter((item) => {
    if (q && !item.name.toLowerCase().includes(q)) return false;
    return state.filter === 'all' || urgencyOf(item) === state.filter;
  });

  const grouped = { expired: [], soon: [], fresh: [] };
  for (const item of visible) grouped[urgencyOf(item)].push(item);
  for (const g of Object.values(grouped)) {
    g.sort((a, b) => new Date(a.expiresAt || '9999') - new Date(b.expiresAt || '9999'));
  }

  if (visible.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><span class="emoji">🔍</span>No items match your search or filter.</div>`;
    return;
  }

  listEl.innerHTML = GROUPS.filter((g) => grouped[g.key].length > 0)
    .map((g) => `
      <h3>${g.emoji} ${g.title} (${grouped[g.key].length})</h3>
      ${grouped[g.key].map((item) => itemCard(item)).join('')}
    `).join('');

  listEl.onclick = (e) => onListClick(e, view, state);
}

function itemCard(item) {
  const urgency = urgencyOf(item);
  return `
    <div class="card urgency-${urgency}" data-id="${esc(item.id)}">
      <div class="section-head">
        <p class="card-title" style="text-transform:capitalize">${esc(item.name)}</p>
        <span class="days-left ${urgency}">${daysLeftText(item.expiresAt)}</span>
      </div>
      <p class="card-sub">
        <span class="chip neutral">${esc(item.category || 'other')}</span>
        ${item.quantity ?? 1} ${esc(item.unit || 'pcs')}
        ${item.source === 'cv' && item.confidence != null ? ` · scanned (${Math.round(item.confidence * 100)}%)` : ''}
      </p>
      <div class="item-actions">
        <button class="btn btn-sm btn-primary" data-action="consume">✓ Consumed</button>
        <button class="btn btn-sm btn-danger" data-action="discard">🗑 Discard</button>
        <button class="btn btn-sm" data-action="edit">✎ Edit</button>
        <button class="btn btn-sm btn-ghost" data-action="delete">Delete</button>
      </div>
      <div class="edit-slot"></div>
    </div>
  `;
}

async function onListClick(e, view, state) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const card = btn.closest('.card[data-id]');
  const id = card.dataset.id;
  const action = btn.dataset.action;

  if (action === 'edit') {
    toggleEditForm(card, view);
    return;
  }

  // Delete requires a confirmation modal — prevent accidental deletion.
  if (action === 'delete') {
    const itemName = card.querySelector('.card-title').textContent.trim();
    showConfirmModal({
      title: 'Delete item?',
      message: `This will permanently delete <strong>${esc(itemName)}</strong> from your inventory.`,
      onConfirm: async () => {
        btn.disabled = true;
        try {
          await api.deleteItem(id);
          toast('Item deleted.', 'success');
          await loadList(view, state);
          refreshAlertBadge();
        } catch {
          btn.disabled = false;
        }
      },
    });
    return;
  }

  btn.disabled = true;
  try {
    if (action === 'consume') {
      await api.consumeItem(id);
      toast('Marked as consumed. Nice!', 'success');
    } else if (action === 'discard') {
      await api.discardItem(id);
      toast('Item discarded.', 'success');
    }
    await loadList(view, state);
    refreshAlertBadge();
  } catch {
    btn.disabled = false;
  }
}

function toggleEditForm(card, view) {
  const slot = card.querySelector('.edit-slot');
  if (slot.innerHTML) {
    slot.innerHTML = '';
    return;
  }
  const name = card.querySelector('.card-title').textContent.trim();
  slot.innerHTML = `
    <form class="edit-form" style="margin-top:10px">
      <div class="field">
        <label>Name</label>
        <input name="name" required value="${esc(name)}">
      </div>
      <div class="field-row">
        <div class="field">
          <label>Category</label>
          <select name="category">${categoryOptions('other')}</select>
        </div>
        <div class="field">
          <label>Expiry date</label>
          <input name="expiry" type="date">
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Quantity</label>
          <input name="quantity" type="number" min="0" step="any" value="1">
        </div>
        <div class="field">
          <label>Unit</label>
          <input name="unit" value="pcs">
        </div>
      </div>
      <button class="btn btn-primary btn-sm" type="submit">Save changes</button>
    </form>
  `;

  // prefill from the item on the server so edits start from real values
  api.getItems('all', { silent: true }).then((data) => {
    const item = (data.items || []).find((i) => String(i.id) === card.dataset.id);
    if (!item) return;
    const form = slot.querySelector('form');
    if (!form) return;
    form.name.value = item.name;
    form.category.value = item.category || 'other';
    form.expiry.value = toDateInputValue(item.expiresAt);
    form.quantity.value = item.quantity ?? 1;
    form.unit.value = item.unit || 'pcs';
  }).catch(() => { /* keep defaults */ });

  slot.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const patch = {
      name: form.name.value.trim(),
      category: form.category.value,
      quantity: Number(form.quantity.value) || 1,
      unit: form.unit.value.trim() || 'pcs',
    };
    if (form.expiry.value) patch.expiresAt = new Date(`${form.expiry.value}T12:00:00`).toISOString();
    try {
      await api.updateItem(card.dataset.id, patch);
      toast('Item updated.', 'success');
      await loadList(view, state);
      refreshAlertBadge();
    } catch { /* toast raised by api */ }
  });
}
