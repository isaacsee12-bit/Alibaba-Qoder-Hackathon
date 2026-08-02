// Settings tab: demo reseed, reliability scan, secure AI key connection, cache reset.

import { api } from './api.js';
import { toast, refreshAlertBadge } from '../app.js';

const LEGACY_KEY_STORAGE = 'fem.llmKey';

function describeStatus(status) {
  if (status.source === 'user') {
    return {
      badge: 'Connected',
      text: `Browser key ending in ${status.suffix || '••••'} is encrypted and ready for Scan and Ask.`,
    };
  }
  if (status.source === 'server') {
    return {
      badge: 'Server key',
      text: 'This deployment is using the OpenAI key configured in Vercel.',
    };
  }
  if (!status.canSaveBrowserKey) {
    return {
      badge: 'Setup needed',
      text: 'Add APP_ENCRYPTION_SECRET in Vercel before connecting a browser API key.',
    };
  }
  return {
    badge: 'Not connected',
    text: 'Connect an OpenAI API key to enable enhanced AI scanning and AI-generated answers.',
  };
}

export async function renderSettings(view) {
  // Remove keys saved by the old display-only localStorage implementation.
  localStorage.removeItem(LEGACY_KEY_STORAGE);

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

    <h3>AI connection</h3>
    <div class="card">
      <div class="section-head">
        <div>
          <p class="card-title">OpenAI API key</p>
          <p class="card-sub" id="ai-key-description">Checking connection…</p>
        </div>
        <span class="pill" id="ai-key-badge">Checking</span>
      </div>

      <div class="field" style="margin-top:16px">
        <label for="llm-key">Connect or replace browser key</label>
        <input id="llm-key" type="password" placeholder="sk-..." autocomplete="new-password" spellcheck="false">
      </div>

      <p class="warning-note">
        The key is validated by the backend, encrypted with <code>APP_ENCRYPTION_SECRET</code>,
        and stored in an HttpOnly cookie. It is never saved in localStorage or committed to GitHub.
        Disconnect it before using a shared computer.
      </p>

      <div class="item-actions">
        <button class="btn btn-primary" id="save-key-btn">Connect key</button>
        <button class="btn" id="test-key-btn" disabled>Test connection</button>
        <button class="btn btn-ghost" id="clear-key-btn" disabled>Disconnect</button>
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
  const badge = view.querySelector('#ai-key-badge');
  const description = view.querySelector('#ai-key-description');
  const saveButton = view.querySelector('#save-key-btn');
  const testButton = view.querySelector('#test-key-btn');
  const clearButton = view.querySelector('#clear-key-btn');

  let currentStatus = {
    connected: false,
    source: 'none',
    suffix: null,
    canSaveBrowserKey: false,
  };

  function renderKeyStatus(status) {
    currentStatus = status;
    const copy = describeStatus(status);
    badge.textContent = copy.badge;
    description.textContent = copy.text;
    saveButton.disabled = !status.canSaveBrowserKey;
    testButton.disabled = !status.connected;
    clearButton.disabled = status.source !== 'user';
  }

  async function refreshKeyStatus() {
    try {
      renderKeyStatus(await api.getAiKeyStatus({ silent: true }));
    } catch {
      badge.textContent = 'Unavailable';
      description.textContent = 'Could not check the AI connection.';
      saveButton.disabled = true;
      testButton.disabled = true;
      clearButton.disabled = true;
    }
  }

  await refreshKeyStatus();

  view.querySelector('#reseed-btn').addEventListener('click', async (event) => {
    event.target.disabled = true;
    try {
      const result = await api.reseedDemo();
      toast(`Demo data reseeded (${result.seeded ?? '?'} items).`, 'success');
      refreshAlertBadge();
    } catch { /* toast raised by api */ }
    event.target.disabled = false;
  });

  view.querySelector('#scan-btn').addEventListener('click', async (event) => {
    event.target.disabled = true;
    try {
      const result = await api.runReliabilityScan();
      const count = result.created ?? (result.flags?.length ?? 0);
      toast(count > 0 ? `Scan complete — ${count} new flag${count === 1 ? '' : 's'} raised.` : 'Scan complete — no issues found.', 'success');
      refreshAlertBadge();
    } catch { /* toast raised by api */ }
    event.target.disabled = false;
  });

  saveButton.addEventListener('click', async () => {
    const value = keyInput.value.trim();
    if (!value) {
      toast('Enter an OpenAI API key first.', 'error');
      return;
    }
    saveButton.disabled = true;
    saveButton.textContent = 'Connecting…';
    try {
      const status = await api.saveAiKey(value);
      keyInput.value = '';
      renderKeyStatus(status);
      toast('API key connected. Scan and Ask will now use it.', 'success');
    } catch {
      await refreshKeyStatus();
    } finally {
      saveButton.textContent = 'Connect key';
      saveButton.disabled = !currentStatus.canSaveBrowserKey;
    }
  });

  testButton.addEventListener('click', async () => {
    testButton.disabled = true;
    testButton.textContent = 'Testing…';
    try {
      const result = await api.testAiKey();
      toast(result.message || 'AI connection successful.', 'success');
    } catch { /* toast raised by api */ }
    testButton.textContent = 'Test connection';
    testButton.disabled = !currentStatus.connected;
  });

  clearButton.addEventListener('click', async () => {
    clearButton.disabled = true;
    try {
      const status = await api.clearAiKey();
      keyInput.value = '';
      renderKeyStatus(status);
      toast(status.source === 'server'
        ? 'Browser key removed. The Vercel server key is still active.'
        : 'API key disconnected from this browser.', 'success');
    } catch {
      await refreshKeyStatus();
    }
  });

  view.querySelector('#clear-cache-btn').addEventListener('click', async () => {
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }
      if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.map((name) => caches.delete(name)));
      }
      toast('Cache cleared — reloading…', 'success');
      setTimeout(() => location.reload(), 600);
    } catch {
      toast('Could not clear the cache.', 'error');
    }
  });
}
