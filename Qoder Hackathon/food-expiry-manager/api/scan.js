const { resolveApiKey } = require('../lib/secure-ai-key');
const { friendlyOpenAIError, scanFoodImage } = require('../lib/openai-food');

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
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
  if (String(req.method || 'GET').toUpperCase() !== 'POST') {
    return json(res, 405, { error: 'method not allowed' });
  }

  const resolved = resolveApiKey(req);
  if (!resolved.key) {
    return json(res, 409, {
      error: 'Connect an OpenAI API key in Settings to use AI image scanning.',
      code: 'AI_KEY_REQUIRED',
    });
  }

  try {
    const result = await scanFoodImage(resolved.key, bodyOf(req).imageDataUrl);
    return json(res, 200, {
      ...result,
      source: 'ai',
      ai: true,
      keySource: resolved.source,
    });
  } catch (error) {
    return json(res, error.status || 502, {
      error: friendlyOpenAIError(error),
      code: error.code || 'AI_SCAN_FAILED',
    });
  }
};
