const inventoryHandler = require('./index');

const SPECIAL_HANDLERS = {
  'ai-key': () => require('./ai-key'),
  'ai-status': () => require('./ai-status'),
  assistant: () => require('./assistant'),
  scan: () => require('./scan'),
};

function firstValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizedRoute(value) {
  return String(firstValue(value) || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.js$/i, '');
}

function requestDetails(req) {
  const url = new URL(req.url || '/', 'https://freshtrack.invalid');
  const queryRoute = firstValue(req.query?.__route);
  const urlRoute = url.searchParams.get('__route');
  const pathRoute = url.pathname.replace(/^\/api\/?/, '');

  return {
    url,
    route: normalizedRoute(queryRoute || urlRoute || pathRoute),
  };
}

function appendQueryValue(query, key, value) {
  if (value == null) return;
  if (Array.isArray(value)) {
    for (const entry of value) query.append(key, String(entry));
    return;
  }
  query.append(key, String(value));
}

function restoreOriginalApiUrl(req, route, url) {
  const query = new URLSearchParams();

  for (const [key, value] of url.searchParams.entries()) {
    if (key !== '__route') query.append(key, value);
  }

  // Vercel may expose rewrite parameters through req.query without retaining
  // them in req.url, so merge both representations.
  for (const [key, value] of Object.entries(req.query || {})) {
    if (key === '__route' || query.has(key)) continue;
    appendQueryValue(query, key, value);
  }

  const suffix = query.toString();
  req.url = `/api/${route}${suffix ? `?${suffix}` : ''}`;
}

module.exports = async function handler(req, res) {
  const { url, route } = requestDetails(req);
  restoreOriginalApiUrl(req, route, url);
  res.setHeader('X-FreshTrack-Route', route || 'unknown');

  const loadSpecialHandler = SPECIAL_HANDLERS[route];
  if (loadSpecialHandler) {
    return loadSpecialHandler()(req, res);
  }

  return inventoryHandler(req, res);
};
