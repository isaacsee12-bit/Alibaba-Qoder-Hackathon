// Settings tab: demo reseed, reliability scan, LLM key (display-only extension point), cache reset.

import { api } from './api.js';
import { toast, refreshAlertBadge } from '../app.js';

const LLM_KEY_STORAGE = 'fem.llmKey';

export async function renderSettings(view) {
  view.innerHTML = `
    <h2>Settings</h2>

    <h3>Demo mode</h3>
    <div class="card">
      <p class="card-sub">Reset the database to a fresh set of sample food items.</p>
      <div class="item-actions">
        <button class="btn btn-primary" id="reseed-btn">🌱 Reseed demo data</button>
      </div>
    </div>

    <h3>Reliability</h3>
    <div class="card">
      <p class="card-sub">Scan the inventory for low-confidence scans, expiry mismatches and other issues.</p>
      <div class="item-actions">
        <button class="btn btn-primary" id="scan-btn">🛡 Run scan now</button>
      </div>
    </div>

    <h3>LLM API key</h3>
    <div class="card">
      <div class="field">
        <label for="llm-key">API key (stored in this browser only)</label>
        <input id="llm-key" type="password" placeholder="sk-..." autocomplete="off">
      </div>
      <p class="warning-note">
        ⚠️ Keys saved here live in localStorage and are <strong>visible to anyone using this
        browser</strong> — never use a production key. For proper setup, put your key in
        <code>backend/.env</code> instead; this field is a display-only extension point.
      </p>
      <div class="item-actions">
        <button class="btn" id="save-key-btn">Save key</button>
        <button class="btn btn-ghost" id="clear-key-btn">Clear key</button>
      </div>
    </div>

    <h3>Storage</h3>
    <div class="card">
      <p class="card-sub">Unregisters the service worker, deletes cached files and reloads the app.</p>
      <div class="item-actions">
        <button class="btn btn-danger" id="clear-cache-btn">🧹 Clear app cache</button>
      </div>
    </div>
  `;

  const keyInput = view.querySelector('#llm-key');
  keyInput.value = localStorage.getItem(LLM_KEY_STORAGE) || '';

  view.querySelector('#reseed-btn').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const res = await api.reseedDemo();
      toast(`Demo data reseeded (${res.seeded ?? '?'} items).`, 'success');
      refreshAlertBadge();
    } catch { /* toast raised by api */ }
    e.target.disabled = false;
  });

  view.querySelector('#scan-btn').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const res = await api.runReliabilityScan();
      const n = res.created ?? (res.flags?.length ?? 0);
      toast(n > 0 ? `Scan complete — ${n} new flag${n === 1 ? '' : 's'} raised.` : 'Scan complete — no issues found.', 'success');
      refreshAlertBadge();
    } catch { /* toast raised by api */ }
    e.target.disabled = false;
  });

  view.querySelector('#save-key-btn').addEventListener('click', () => {
    const val = keyInput.value.trim();
    if (!val) {
      toast('Enter a key first, or use Clear key.', 'error');
      return;
    }
    localStorage.setItem(LLM_KEY_STORAGE, val);
    toast('Key saved locally. Remember: backend/.env is the proper place.', 'success');
  });

  view.querySelector('#clear-key-btn').addEventListener('click', () => {
    localStorage.removeItem(LLM_KEY_STORAGE);
    keyInput.value = '';
    toast('Key removed from this browser.', 'success');
  });

  view.querySelector('#clear-cache-btn').addEventListener('click', async () => {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.map((n) => caches.delete(n)));
      }
      toast('Cache cleared — reloading…', 'success');
      setTimeout(() => location.reload(), 600);
    } catch {
      toast('Could not clear the cache.', 'error');
    }
  });
}
