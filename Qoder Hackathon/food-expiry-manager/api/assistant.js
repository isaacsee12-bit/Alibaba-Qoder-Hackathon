const DAY_MS = 86400000;
const { resolveApiKey } = require('../lib/secure-ai-key');
const {
  askFoodAssistant,
  cleanItems,
  friendlyAiError,
} = require('../lib/ai-provider');

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

function daysUntil(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - Date.now()) / DAY_MS);
}

const NUTRITION_GOALS = ['High Protein', 'Low Sugar', 'Low Sodium', 'Low Fat'];

/** Keep only known nutrition goal presets, without duplicates. */
function cleanGoals(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const goals = [];
  for (const goal of value) {
    const g = String(goal || '').trim();
    if (NUTRITION_GOALS.includes(g) && !seen.has(g)) {
      seen.add(g);
      goals.push(g);
    }
  }
  return goals;
}

function goalNote(goals) {
  return goals.length
    ? ` To match your nutrition goal${goals.length === 1 ? '' : 's'} (${goals.join(', ')}), lean on the items that fit those goals best and keep portions sensible.`
    : '';
}

function fallbackAnswer(question, items, goals = []) {
  if (!items.length) return 'Your inventory is empty. Add or scan some food first, then I can suggest what to cook and what to use soon.';
  // Expired items are never usable — only food that is still available can be recommended.
  const usable = items.filter((item) => {
    if (!item.expiresAt) return true;
    const d = daysUntil(item.expiresAt);
    return d !== null && d >= 0;
  });
  if (!usable.length) return 'Everything in your inventory is expired. Remove those items, add fresh food, and then I can suggest a recipe.';
  const urgent = [...usable]
    .map((item) => ({ ...item, days: daysUntil(item.expiresAt) }))
    .filter((item) => item.days !== null)
    .sort((a, b) => a.days - b.days)
    .slice(0, 4);
  const names = urgent.length ? urgent.map((item) => item.name) : usable.slice(0, 4).map((item) => item.name);
  const lower = question.toLowerCase();
  if (lower.includes('healthy')) {
    return `For a healthier meal, combine ${names.slice(0, 3).join(', ')} with a simple protein and whole grain. Use minimal oil, add vegetables, and check that every item is still safe before cooking.`;
  }
  if (lower.includes('first') || lower.includes('waste') || lower.includes('expire')) {
    return `Use ${names.join(', ')} first because they are the most time-sensitive items in your inventory. Plan one meal around them today and freeze anything you cannot use safely.`;
  }
  return `A practical option is to build a simple bowl, stir-fry, soup, or sandwich using ${names.join(', ')}. Start with the items expiring soonest, season simply, and confirm freshness before eating.${goalNote(goals)}`;
}

module.exports = async function handler(req, res) {
  if (String(req.method || 'GET').toUpperCase() !== 'POST') {
    return json(res, 405, { error: 'method not allowed' });
  }

  const body = bodyOf(req);
  const question = String(body.question || '').trim().slice(0, 600);
  const items = cleanItems(body.items);
  const goals = cleanGoals(body.goals);
  if (!question) return json(res, 400, { error: 'question is required' });

  const resolved = resolveApiKey(req);
  if (!resolved.key || !resolved.provider) {
    return json(res, 200, {
      answer: fallbackAnswer(question, items, goals),
      ai: false,
      provider: null,
      keySource: 'none',
    });
  }

  try {
    const result = await askFoodAssistant(
      resolved.provider,
      resolved.key,
      question,
      items
    );
    return json(res, 200, {
      ...result,
      ai: true,
      provider: resolved.provider,
      keySource: resolved.source,
    });
  } catch (error) {
    console.error(`${resolved.provider} assistant failed:`, error.message);
    return json(res, 200, {
      answer: fallbackAnswer(question, items, goals),
      ai: false,
      provider: resolved.provider,
      keySource: resolved.source,
      warning: friendlyAiError(resolved.provider, error),
      code: error.code || 'AI_ASSISTANT_FAILED',
    });
  }
};
