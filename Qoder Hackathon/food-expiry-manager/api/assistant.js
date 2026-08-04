const { resolveApiKey } = require('../lib/secure-ai-key');
const {
  askFoodAssistant,
  cleanItems,
  friendlyAiError,
} = require('../lib/ai-provider');
const {
  cleanHistory,
  fallbackAnswer,
} = require('../lib/assistant-conversation');

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

const NUTRITION_GOALS = ['High Protein', 'Low Sugar', 'Low Sodium', 'Low Fat'];

/** Keep only known nutrition goal presets, without duplicates. */
function cleanGoals(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const goals = [];
  for (const goal of value) {
    const normalized = String(goal || '').trim();
    if (NUTRITION_GOALS.includes(normalized) && !seen.has(normalized)) {
      seen.add(normalized);
      goals.push(normalized);
    }
  }
  return goals;
}

module.exports = async function handler(req, res) {
  if (String(req.method || 'GET').toUpperCase() !== 'POST') {
    return json(res, 405, { error: 'method not allowed' });
  }

  const body = bodyOf(req);
  const question = String(body.question || '').trim().slice(0, 600);
  const items = cleanItems(body.items);
  const goals = cleanGoals(body.goals);
  const history = cleanHistory(body.history, question);
  if (!question) return json(res, 400, { error: 'question is required' });

  const resolved = resolveApiKey(req);
  if (!resolved.key || !resolved.provider) {
    return json(res, 200, {
      answer: fallbackAnswer(question, items, goals, history),
      ai: false,
      provider: null,
      keySource: 'none',
      contextUsed: history.length > 0,
    });
  }

  try {
    const result = await askFoodAssistant(
      resolved.provider,
      resolved.key,
      question,
      items,
      history
    );
    return json(res, 200, {
      ...result,
      ai: true,
      provider: resolved.provider,
      keySource: resolved.source,
      contextUsed: history.length > 0,
    });
  } catch (error) {
    console.error(`${resolved.provider} assistant failed:`, error.message);
    return json(res, 200, {
      answer: fallbackAnswer(question, items, goals, history),
      ai: false,
      provider: resolved.provider,
      keySource: resolved.source,
      warning: friendlyAiError(resolved.provider, error),
      code: error.code || 'AI_ASSISTANT_FAILED',
      contextUsed: history.length > 0,
    });
  }
};