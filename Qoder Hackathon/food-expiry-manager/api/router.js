const inventoryHandler = require('./index');

const SPECIAL_HANDLERS = {
  'ai-key': () => require('./ai-key'),
  'ai-status': () => require('./ai-status'),
  assistant: () => require('./assistant'),
  scan: () => require('./scan'),
};

function normalizedRoute(value) {
  return String(value || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.js$/i, '');
}

function requestDetails(req) {
  const url = new URL(req.url || '/', 'https://freshtrack.invalid');
  const explicitRoute = url.searchParams.get('__route');
  const pathRoute = url.pathname.replace(/^\/api\/?/, '');
  return {
    url,
    route: normalizedRoute(explicitRoute || pathRoute),
  };
}

function restoreOriginalApiUrl(req, route, url) {
  const query = new URLSearchParams(url.searchParams);
  query.delete('__route');
  const suffix = query.toString();
  req.url = `/api/${route}${suffix ? `?${suffix}` : ''}`;
}

module.exports = async function handler(req, res) {
  const { url, route } = requestDetails(req);
  restoreOriginalApiUrl(req, route, url);

  const loadSpecialHandler = SPECIAL_HANDLERS[route];
  if (loadSpecialHandler) {
    return loadSpecialHandler()(req, res);
  }

  return inventoryHandler(req, res);
};
