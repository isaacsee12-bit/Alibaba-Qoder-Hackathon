/**
 * services/llmClient.js — optional LLM extension point for the food assistant.
 *
 * Reads provider keys from .env (loaded by server.js via dotenv):
 *   - OPENAI_API_KEY or LLM_API_KEY     → OpenAI chat completions
 *   - GEMINI_API_KEY or GOOGLE_API_KEY  → Google Gemini generateContent
 *   - AI_PROVIDER=openai|gemini         → preferred provider when both are set
 *   - OPENAI_MODEL / GEMINI_MODEL       → optional model overrides
 *
 * Without any key everything here is disabled and returns null, so callers
 * fall back to the built-in rule-based recommendations/insights.
 */

const path = require('path');
const recipes = require(path.join(__dirname, '..', 'data', 'recipes.json'));
const shelfLife = require('./shelfLife');

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';

function openAIKey() {
  return process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || '';
}

function geminiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
}

function isEnabled() {
  return !!(openAIKey() || geminiKey());
}

/** Pick the active provider: AI_PROVIDER preference wins, otherwise any configured key. */
function preferredProvider() {
  const pref = String(process.env.AI_PROVIDER || '').toLowerCase();
  if (pref === 'openai' && openAIKey()) return 'openai';
  if (pref === 'gemini' && geminiKey()) return 'gemini';
  if (openAIKey()) return 'openai';
  if (geminiKey()) return 'gemini';
  return null;
}

/** Whole days from today until the given ISO date (negative = past), matching frontend util.js. */
function daysUntil(iso) {
  if (!iso) return null;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((startOfTarget - startOfToday) / 86400000);
}

function daysLeftText(iso) {
  const d = daysUntil(iso);
  if (d === null) return 'no expiry set';
  if (d === 0) return 'expires today';
  if (d === 1) return 'expires tomorrow';
  return `${d} days left`;
}

/** Build the user prompt: the question plus the inventory with expiry context. */
function buildPrompt(question, items) {
  const list = items.map((item) => {
    const d = daysUntil(item.expiresAt);
    const expiry = d === null ? 'no expiry set' : `expires in ${d} day${d === 1 ? '' : 's'}`;
    return `- ${item.name} (${expiry})`;
  });
  return `${question}\n\nMy available ingredients, most urgent first:\n${list.join('\n')}`;
}

async function askOpenAI(question, items) {
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openAIKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
      messages: [{ role: 'user', content: buildPrompt(question, items) }],
      temperature: 0.7,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI request failed (${res.status})`);
  const data = await res.json();
  const answer = data?.choices?.[0]?.message?.content;
  if (!answer) throw new Error('OpenAI returned an empty response');
  return answer.trim();
}

async function askGemini(question, items) {
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const res = await fetch(
    `${GEMINI_URL}/${model}:generateContent?key=${encodeURIComponent(geminiKey())}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(question, items) }] }],
        generationConfig: { temperature: 0.7 },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini request failed (${res.status})`);
  const data = await res.json();
  const answer = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text).join('');
  if (!answer) throw new Error('Gemini returned an empty response');
  return answer.trim();
}

/** One-shot LLM call. Returns { answer, provider } or throws. */
async function callLLM(question, items) {
  const provider = preferredProvider();
  if (!provider) throw new Error('No LLM provider is configured');
  const answer = provider === 'openai' ? await askOpenAI(question, items) : await askGemini(question, items);
  return { answer, provider };
}

/** Strip markdown fences and extract a JSON array from a model response. */
function parseJsonArray(text) {
  const cleaned = String(text).replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** True when a recipe ingredient refers to the given item name (fuzzy). */
function ingredientMatchesItem(ingredient, itemName) {
  const a = shelfLife.normalize(ingredient);
  const b = shelfLife.normalize(itemName);
  if (a === b) return true;
  // resolve both through the reference catalog so "bananas" matches "banana"
  const ma = shelfLife.findMatch(a);
  const mb = shelfLife.findMatch(b);
  return !!(ma && mb && ma.matchedName === mb.matchedName);
}

/**
 * Answer an open-ended assistant question with the given inventory context.
 * @returns {Promise<{answer: string, provider: string}|null>} null when disabled or on failure.
 */
async function askAssistant(question, items) {
  if (!isEnabled()) return null;
  try {
    return await callLLM(question, items);
  } catch (err) {
    console.error('LLM assistant failed:', err.message);
    return null;
  }
}

/**
 * Suggest recipes for the given expiring items via an LLM.
 * @returns {Promise<Array|null>} [{title, ingredients, instructions, usesItems}] or null.
 */
async function suggestRecipes(expiringItems) {
  if (!isEnabled() || expiringItems.length === 0) return null;
  try {
    const names = expiringItems.map((i) => i.name).join(', ');
    const { answer } = await callLLM(
      `Suggest 3 simple recipes using some of these ingredients: ${names}. ` +
      'Reply with ONLY a JSON array, no markdown: [{"title": "...", "ingredients": ["..."], "instructions": "..."}]',
      expiringItems
    );
    const parsed = parseJsonArray(answer);
    if (!parsed || parsed.length === 0) return null;
    return parsed.map((r) => ({
      title: String(r.title || 'Untitled recipe'),
      ingredients: Array.isArray(r.ingredients) ? r.ingredients.map(String) : [],
      instructions: String(r.instructions || ''),
      usesItems: expiringItems.filter((item) =>
        r.ingredients.some((ing) => ingredientMatchesItem(ing, item.name))
      ),
    }));
  } catch (err) {
    console.error('LLM recipe suggestion failed:', err.message);
    return null;
  }
}

/**
 * Generate personalized diet advice from inventory + insights via an LLM.
 * @returns {Promise<Object|null>} {eatMore: [{category, reason}], eatLess: [...]} or null.
 */
async function dietAdvice(insights) {
  if (!isEnabled() || !insights) return null;
  try {
    const { answer } = await callLLM(
      'Based on this pantry balance, give concise eat-more and eat-less advice. ' +
      'Reply with ONLY a JSON object, no markdown: ' +
      '{"eatMore": [{"category": "...", "reason": "..."}], "eatLess": [{"category": "...", "reason": "..."}]}. ' +
      `Context: ${JSON.stringify(insights)}`,
      []
    );
    const cleaned = String(answer).replace(/```(?:json)?/gi, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      eatMore: Array.isArray(parsed?.eatMore) ? parsed.eatMore : [],
      eatLess: Array.isArray(parsed?.eatLess) ? parsed.eatLess : [],
    };
  } catch (err) {
    console.error('LLM diet advice failed:', err.message);
    return null;
  }
}

/**
 * Deterministic rule-based answer used when no LLM key is configured (or the
 * LLM call failed): picks the cookbook recipe that uses the most soonest-
 * expiring inventory items and formats it as readable text.
 */
function fallbackAnswer(question, items) {
  if (!items.length) {
    return 'Your inventory is empty. Add or scan some food first, then I can suggest what to cook and what to use soon.';
  }
  const matched = recipes
    .map((recipe) => ({
      recipe,
      usesItems: items.filter((item) => recipe.ingredients.some((ing) => ingredientMatchesItem(ing, item.name))),
    }))
    .filter((m) => m.usesItems.length > 0)
    .sort((a, b) => b.usesItems.length - a.usesItems.length);

  if (matched.length) {
    const { recipe, usesItems } = matched[0];
    const lines = [
      "Here's a recipe using your soonest-expiring ingredients:",
      '',
      recipe.title,
      '',
      'Ingredients:',
      ...recipe.ingredients.map((i) => `• ${i}`),
      '',
      'Instructions:',
      recipe.instructions,
      '',
      `Uses: ${usesItems.map((i) => `${i.name}${i.expiresAt ? ` (${daysLeftText(i.expiresAt)})` : ''}`).join(', ')}`,
    ];
    return lines.join('\n');
  }

  const names = items.slice(0, 4).map((i) => i.name).join(', ');
  return `I couldn't find a matching recipe in the cookbook, but you can build a simple bowl, stir-fry, soup, or sandwich using ${names}. Start with the items expiring soonest, season simply, and confirm freshness before eating.`;
}

module.exports = { isEnabled, askAssistant, suggestRecipes, dietAdvice, fallbackAnswer };
