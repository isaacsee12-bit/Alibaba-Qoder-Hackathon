const { keyStatus } = require('../lib/secure-ai-key');

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (String(req.method || 'GET').toUpperCase() !== 'GET') {
    return json(res, 405, { error: 'method not allowed' });
  }

  try {
    return json(res, 200, keyStatus(req));
  } catch (error) {
    console.error('AI status check failed:', error);
    // Keep Settings usable even when status diagnostics fail. The connect request
    // will still return the exact configuration/provider error to the user.
    return json(res, 200, {
      connected: false,
      provider: null,
      source: 'none',
      suffix: null,
      canSaveBrowserKey: true,
      statusError: 'The server could not read the current AI connection status.',
      code: error?.code || 'AI_STATUS_FAILED',
    });
  }
};
