// Thin fetch wrapper around the backend REST contract.
// All modules go through this; failures surface as friendly toasts via api.onError.

const BASE = '/api';
const ASSISTANT_CHAT_STORAGE_KEY = 'fem.assistantChat';
const MAX_ASSISTANT_CONTEXT_MESSAGES = 10;

function assistantHistoryFor(question) {
  const current = String(question || '').trim();
  let stored;
  try {
    stored = JSON.parse(localStorage.getItem(ASSISTANT_CHAT_STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(stored)) return [];

  const messages = stored
    .map((entry) => {
      const rawRole = String(entry?.role || '').toLowerCase();
      const role = rawRole === 'user' ? 'user' : rawRole === 'bot' || rawRole === 'assistant' ? 'assistant' : null;
      const text = String(entry?.text || '').trim().slice(0, 1200);
      const prompt = String(entry?.prompt || '').trim();
      return role && text ? { role, text, prompt } : null;
    })
    .filter(Boolean);

  // The Ask UI stores the current user message before calling the API.
  // Remove that duplicate because the current question is sent separately.
  const trailing = messages[messages.length - 1];
  if (trailing?.role === 'user' && current && trailing.text === current) messages.pop();

  // Regeneration should use the conversation before the answer being replaced,
  // not feed that answer back to the model and encourage an identical response.
  const last = messages[messages.length - 1];
  if (last?.role === 'assistant' && current && last.prompt === current) {
    messages.pop();
    const repeatedUser = messages[messages.length - 1];
    if (repeatedUser?.role === 'user' && repeatedUser.text === current) messages.pop();
  }

  return messages
    .slice(-MAX_ASSISTANT_CONTEXT_MESSAGES)
    .map(({ role, text }) => ({ role, text }));
}

async function request(method, path, body, opts = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (!opts.silent) api.onError('Cannot reach the server. Is the backend running?');
    throw err;
  }
  if (!res.ok) {
    let detail = '';
    let code = '';
    try {
      const data = await res.json();
      detail = data.error || data.message || '';
      code = data.code || '';
    } catch { /* non-JSON error body */ }
    const msg = detail || `Request failed (${res.status})`;
    const error = new Error(msg);
    error.status = res.status;
    error.code = code;
    if (!opts.silent) api.onError(msg);
    throw error;
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  // hook assigned by app.js
  onError: () => {},

  // items
  getItems: (status = 'active', opts) => request('GET', `/items?status=${status}`, null, opts),
  createItem: (item, opts) => request('POST', '/items', item, opts),
  updateItem: (id, patch, opts) => request('PUT', `/items/${id}`, patch, opts),
  deleteItem: (id, opts) => request('DELETE', `/items/${id}`, null, opts),
  consumeItem: (id, opts) => request('POST', `/items/${id}/consume`, null, opts),
  discardItem: (id, opts) => request('POST', `/items/${id}/discard`, null, opts),

  // alerts & recommendations
  getAlerts: (opts) => request('GET', '/alerts', null, opts),
  getRecommendations: (opts) => request('GET', '/recommendations', null, opts),

  // insights
  getInsights: (opts) => request('GET', '/insights', null, opts),

  // AI connection, assistant, and vision scan
  getAiKeyStatus: (opts) => request('GET', '/ai-status', null, opts),
  saveAiKey: (provider, key, opts) => request('POST', '/ai-key', { provider, key }, opts),
  testAiKey: (opts) => request('POST', '/ai-key', { action: 'test' }, opts),
  clearAiKey: (opts) => request('DELETE', '/ai-key', null, opts),
  askAssistant: (payload, opts) => {
    const body = { ...(payload || {}) };
    if (!Array.isArray(body.history)) body.history = assistantHistoryFor(body.question);
    return request('POST', '/assistant', body, opts);
  },
  scanFoodWithAi: (imageDataUrl, opts) => request('POST', '/scan', { imageDataUrl }, opts),

  // reliability
  getReliabilityFlags: (opts) => request('GET', '/reliability/flags', null, opts),
  runReliabilityScan: (opts) => request('POST', '/reliability/scan', null, opts),
  resolveFlag: (id, opts) => request('POST', `/reliability/flags/${id}/resolve`, null, opts),

  // system
  getHealth: (opts) => request('GET', '/health', null, opts),
  reseedDemo: (opts) => request('POST', '/demo/reseed', null, opts),
};