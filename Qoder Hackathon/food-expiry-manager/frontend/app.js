// App entry: hash router, health check, alert badge, toast helper.
import { api } from './modules/api.js';
import { renderScan } from './modules/camera.js';
import { renderInventory } from './modules/inventory.js';
import { renderAlerts } from './modules/alerts.js';
import { renderInsights } from './modules/insights.js';
import { renderSettings } from './modules/settings.js';

const routes = {
  scan: renderScan,
  inventory: renderInventory,
  alerts: renderAlerts,
  insights: renderInsights,
  settings: renderSettings,
};

const viewEl = document.getElementById('view');

/** Show a transient toast. type: 'info' | 'success' | 'error' */
export function toast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type === 'info' ? '' : type}`.trim();
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 350);
  }, 3200);
}

// api module raises toast on failure through this hook
api.onError = (msg) => toast(msg, 'error');

function currentTab() {
  const hash = location.hash.replace('#', '');
  return routes[hash] ? hash : 'scan';
}

async function navigate() {
  const tab = currentTab();
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  viewEl.innerHTML = '';
  try {
    await routes[tab](viewEl);
  } catch (err) {
    console.error('View render failed:', err);
    viewEl.innerHTML = `<div class="empty-state"><span class="emoji">⚠️</span>Something went wrong rendering this tab.</div>`;
  }
  refreshAlertBadge();
}

/** Update the unresolved-flags badge on the Alerts tab. */
export async function refreshAlertBadge() {
  const badge = document.getElementById('alert-badge');
  try {
    const data = await api.getReliabilityFlags({ silent: true });
    const count = (data.flags || []).filter((f) => !f.resolved).length;
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.classList.toggle('hidden', count === 0);
  } catch {
    badge.classList.add('hidden');
  }
}

async function checkHealth() {
  try {
    const health = await api.getHealth({ silent: true });
    document.getElementById('demo-pill').classList.toggle('hidden', health.mode !== 'demo');
  } catch {
    // backend not reachable — leave pill hidden, tabs will show empty states
  }
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('SW registration failed:', err);
    });
  }
}

window.addEventListener('hashchange', navigate);
window.addEventListener('load', () => {
  if (!location.hash) location.hash = '#scan';
  registerSW();
  checkHealth();
  navigate();
});
