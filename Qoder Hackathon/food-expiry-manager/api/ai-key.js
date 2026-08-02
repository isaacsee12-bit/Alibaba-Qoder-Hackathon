const {
  assertSameOrigin,
  clearUserKeyCookie,
  keyStatus,
  resolveApiKey,
  resolveServerApiKey,
  writeUserKeyCookie,
} = require('../lib/secure-ai-key');

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

function providerTools() {
  // Load provider adapters only when validating or testing a key. A simple GET
  // status check must not depend on either provider SDK/request implementation.
  return require('../lib/ai-provider');
}

function friendlyError(provider, error) {
  if (error?.code === 'AI_KEY_CONFIG_MISSING') return error.message;
  try {
    return providerTools().friendlyAiError(provider || 'openai', error);
  } catch {
    return error?.message || 'The AI connection request failed.';
  }
}

module.exports = async function handler(req, res) {
  const method = String(req.method || 'GET').toUpperCase();
  let provider = null;

  try {
    if (method === 'GET') {
      return json(res, 200, keyStatus(req));
    }

    if (method === 'DELETE') {
      assertSameOrigin(req);
      clearUserKeyCookie(req, res);
      const server = resolveServerApiKey();
      return json(res, 200, {
        connected: Boolean(server.key),
        provider: server.provider,
        source: server.source,
        suffix: null,
        canSaveBrowserKey: keyStatus(req).canSaveBrowserKey,
      });
    }

    if (method !== 'POST') return json(res, 405, { error: 'method not allowed' });

    assertSameOrigin(req);
    const body = bodyOf(req);
    const {
      normalizeProvider,
      providerLabel,
      validateProviderApiKey,
    } = providerTools();

    if (body.action === 'test') {
      const resolved = resolveApiKey(req);
      provider = resolved.provider;
      if (!resolved.key || !provider) {
        return json(res, 409, {
          error: 'No AI API key is connected.',
          code: 'AI_KEY_REQUIRED',
        });
      }
      await validateProviderApiKey(provider, resolved.key);
      return json(res, 200, {
        ok: true,
        provider,
        source: resolved.source,
        message: `${providerLabel(provider)} connection successful.`,
      });
    }

    provider = normalizeProvider(body.provider || 'openai');
    if (!provider) {
      return json(res, 400, {
        error: 'Choose OpenAI or Google Gemini.',
        code: 'INVALID_AI_PROVIDER',
      });
    }

    const apiKey = String(body.key || '').trim();
    if (apiKey.length < 20 || apiKey.length > 512) {
      return json(res, 400, {
        error: `Enter a valid ${providerLabel(provider)} API key.`,
        code: 'INVALID_KEY_FORMAT',
      });
    }

    await validateProviderApiKey(provider, apiKey);
    writeUserKeyCookie(req, res, provider, apiKey);
    return json(res, 200, {
      connected: true,
      provider,
      source: 'user',
      suffix: apiKey.slice(-4),
      canSaveBrowserKey: true,
      message: `${providerLabel(provider)} API key connected securely.`,
    });
  } catch (error) {
    return json(res, error?.status || 502, {
      error: friendlyError(provider, error),
      code: error?.code || 'AI_KEY_REQUEST_FAILED',
    });
  }
};
