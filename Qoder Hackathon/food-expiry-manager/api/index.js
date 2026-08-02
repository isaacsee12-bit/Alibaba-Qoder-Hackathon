const inventoryHandler = require('./inventory');

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

function requestedRoute(req) {
  const url = new URL(req.url || '/', 'https://freshtrack.invalid');
  const queryRoute = firstValue(req.query?.__route);
  const urlRoute = url.searchParams.get('__route');
  const pathRoute = url.pathname.replace(/^\/api\/?/, '');
  return normalizedRoute(queryRoute || urlRoute || pathRoute);
}

module.exports = async function handler(req, res) {
  const route = requestedRoute(req);
  res.setHeader('X-FreshTrack-Index-Route', route || 'unknown');

  const loadSpecialHandler = SPECIAL_HANDLERS[route];
  if (loadSpecialHandler) {
    return loadSpecialHandler()(req, res);
  }

  return inventoryHandler(req, res);
};
