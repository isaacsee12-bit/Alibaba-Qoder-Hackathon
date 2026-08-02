const {
  assertSameOrigin,
  clearUserKeyCookie,
  keyStatus,
  resolveApiKey,
  writeUserKeyCookie,
} = require('../lib/secure-ai-key');
const { friendlyOpenAIError, validateApiKey } = require('../lib/openai-food');

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  res.end(JSON.stringify(body));
}

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
}

module.exports = async function handler(req, res) {
  const method = String(req.method || 'GET').toUpperCase();

  try {
    if (method === 'GET') {
      return json(res, 200, keyStatus(req));
    }

    if (method === 'DELETE') {
      assertSameOrigin(req);
      clearUserKeyCookie(req, res);
      const serverConnected = Boolean(process.env.OPENAI_API_KEY || process.env.LLM_API_KEY);
      return json(res, 200, {
        connected: serverConnected,
        source: serverConnected ? 'server' : 'none',
        suffix: null,
        canSaveBrowserKey: keyStatus(req).canSaveBrowserKey,
      });
    }

    if (method !== 'POST') return json(res, 405, { error: 'method not allowed' });

    assertSameOrigin(req);
    const body = bodyOf(req);

    if (body.action === 'test') {
      const resolved = resolveApiKey(req);
      if (!resolved.key) return json(res, 409, { error: 'No AI API key is connected.', code: 'AI_KEY_REQUIRED' });
      await validateApiKey(resolved.key);
      return json(res, 200, {
        ok: true,
        source: resolved.source,
        message: 'Connection successful.',
      });
    }

    const apiKey = String(body.key || '').trim();
    if (apiKey.length < 20 || apiKey.length > 512) {
      return json(res, 400, { error: 'Enter a valid OpenAI API key.', code: 'INVALID_KEY_FORMAT' });
    }

    await validateApiKey(apiKey);
    writeUserKeyCookie(req, res, apiKey);
    return json(res, 200, {
      connected: true,
      source: 'user',
      suffix: apiKey.slice(-4),
      canSaveBrowserKey: true,
      message: 'API key connected securely.',
    });
  } catch (error) {
    const status = error.status || 502;
    return json(res, status, {
      error: error.code === 'AI_KEY_CONFIG_MISSING' ? error.message : friendlyOpenAIError(error),
      code: error.code || 'AI_KEY_REQUEST_FAILED',
    });
  }
};
