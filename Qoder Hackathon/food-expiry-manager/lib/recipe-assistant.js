const { discoverGeminiModel } = require('./gemini-food');

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const REQUEST_TIMEOUT_MS = 30000;

class RecipeAssistantError extends Error {
  constructor(message, status = 502, code = 'RECIPE_ASSISTANT_FAILED', details = null) {
    super(message);
    this.name = 'RecipeAssistantError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function isRecipeRequest(question) {
  const value = String(question || '').toLowerCase();
  const explicitRecipe = /\b(recipe|ingredients section|numbered steps|cooking instructions|how to make)\b/.test(value)
    && /\b(generate|create|build|make|provide|return|recipe)\b/.test(value);
  const quickStartRecipe = /\b(expir(?:e|es|ing|y)|healthy|high[-\s]?protein|15[-\s]?minute|quick|fast)\b/.test(value)
    && /\b(meal|cook|cooking|recipe|food|dish)\b/.test(value);
  const anotherRecipe = /\b(another|different|new|alternative)\b/.test(value)
    && /\b(recipe|meal|dish|option)\b/.test(value);
  return explicitRecipe || quickStartRecipe || anotherRecipe;
}

function cleanRecipeItems(items) {
  return (Array.isArray(items) ? items : [])
    .slice(0, 40)
    .map((item) => ({
      name: String(item?.name || '').trim().slice(0, 80),
      category: String(item?.category || 'other').trim().slice(0, 40),
      quantity: item?.quantity ?? null,
      unit: item?.unit ?? null,
      expiresAt: item?.expiresAt || null,
    }))
    .filter((item) => item.name);
}

function inventoryText(items) {
  const clean = cleanRecipeItems(items);
  if (!clean.length) return 'No inventory items available.';
  return clean.map((item) => {
    const quantity = item.quantity != null ? `; quantity ${item.quantity} ${item.unit || ''}` : '';
    const expiry = item.expiresAt ? `; expires ${String(item.expiresAt).slice(0, 10)}` : '';
    return `${item.name} (${item.category}${quantity}${expiry})`;
  }).join('\n');
}

function recipeInstructions() {
  return [
    'You are FreshTrack, a food-inventory recipe assistant.',
    'Create one complete, practical recipe using ONLY ingredients present in the supplied inventory.',
    'Treat the current user request as the primary objective: expiring-soon, healthy, 15-minute, and high-protein requests must produce recipes optimized for that specific goal.',
    'If the recent conversation contains a previous recipe, do not repeat it. Choose a materially different recipe title, cooking method, and ingredient combination whenever the inventory allows.',
    'For a request for another or different recipe, explicitly avoid the most recently suggested recipe.',
    'For a high-protein request, prioritize genuine protein-rich inventory items. If none are available, state that limitation briefly and create the highest-protein option possible without falsely calling it high-protein.',
    'For a 15-minute request, only claim 15 minutes when the listed steps can realistically be completed in that time; identify any ingredient that must already be cooked.',
    'For an expiring-soon request, prioritize unexpired ingredients with the nearest expiry dates.',
    'For a healthy request, emphasize vegetables and balanced portions while staying within the supplied inventory.',
    'Never add pantry staples, seasonings, oils, water, garnishes, or optional ingredients unless they appear in the inventory.',
    'Return plain text with these exact sections: a short recipe title on the first line, Ingredients, Steps, and Food safety note.',
    'Under Ingredients, list quantities using the available inventory amounts where possible.',
    'Under Steps, provide clear numbered cooking instructions.',
    'Keep the recipe useful and complete rather than artificially short.',
    'Do not state that food is safe solely from its date or appearance.',
  ].join(' ');
}

function extractOpenAIText(data) {
  if (typeof data?.output_text === 'string') return data.output_text.trim();
  for (const output of data?.output || []) {
    for (const content of output?.content || []) {
      if (content?.type === 'output_text' && content?.text) return String(content.text).trim();
    }
  }
  return '';
}

async function fetchJson(url, options, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    return { response, data };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new RecipeAssistantError('The recipe request timed out.', 504, 'RECIPE_TIMEOUT');
    }
    throw new RecipeAssistantError(
      'The server could not reach the AI recipe service.',
      502,
      'RECIPE_NETWORK_ERROR',
      error?.message || null
    );
  } finally {
    clearTimeout(timer);
  }
}

function responseError(response, data, provider) {
  const message = data?.error?.message || `${provider} recipe request failed (${response.status})`;
  const code = data?.error?.code
    || data?.error?.type
    || data?.error?.status
    || data?.error?.details?.find?.((item) => item?.reason)?.reason
    || 'RECIPE_ASSISTANT_FAILED';
  return new RecipeAssistantError(message, response.status, code, data?.error?.details || null);
}

async function requestOpenAIRecipe(apiKey, question, items, maxOutputTokens) {
  const { response, data } = await fetchJson('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5-mini',
      store: false,
      max_output_tokens: maxOutputTokens,
      instructions: recipeInstructions(),
      input: `Inventory:\n${inventoryText(items)}\n\nUser request and recent context:\n${String(question || '').slice(0, 1200)}`,
    }),
  });

  if (!response.ok) throw responseError(response, data, 'OpenAI');
  return data;
}

async function askOpenAIRecipe(apiKey, question, items) {
  let data = await requestOpenAIRecipe(apiKey, question, items, 1800);
  let answer = extractOpenAIText(data);
  const incomplete = data?.status === 'incomplete'
    || String(data?.incomplete_details?.reason || '').includes('max_output_tokens');

  if (incomplete || !answer) {
    data = await requestOpenAIRecipe(apiKey, question, items, 3200);
    answer = extractOpenAIText(data);
  }

  if (!answer) {
    throw new RecipeAssistantError('OpenAI returned an empty recipe.', 502, 'EMPTY_MODEL_RESPONSE');
  }
  return {
    answer,
    model: data?.model || process.env.OPENAI_MODEL || 'gpt-5-mini',
  };
}

function geminiThinkingConfig(model) {
  if (/^gemini-3(?:\.|-)/i.test(model)) return { thinkingLevel: 'LOW' };
  if (/^gemini-2\.5-(?:flash|flash-lite)/i.test(model)) return { thinkingBudget: 0 };
  return undefined;
}

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => String(part?.text || '')).join('').trim();
}

async function requestGeminiRecipe(apiKey, model, question, items, maxOutputTokens) {
  const generationConfig = { maxOutputTokens };
  const thinkingConfig = geminiThinkingConfig(model);
  if (thinkingConfig) generationConfig.thinkingConfig = thinkingConfig;

  const { response, data } = await fetchJson(
    `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: recipeInstructions() }] },
        contents: [{
          role: 'user',
          parts: [{
            text: `Inventory:\n${inventoryText(items)}\n\nUser request and recent context:\n${String(question || '').slice(0, 1200)}`,
          }],
        }],
        generationConfig,
      }),
    }
  );

  if (!response.ok) throw responseError(response, data, 'Gemini');
  return data;
}

async function askGeminiRecipe(apiKey, question, items) {
  const model = await discoverGeminiModel(apiKey, process.env.GEMINI_MODEL);
  let data = await requestGeminiRecipe(apiKey, model, question, items, 4096);
  let answer = extractGeminiText(data);
  const truncated = String(data?.candidates?.[0]?.finishReason || '').toUpperCase() === 'MAX_TOKENS';

  if (truncated || !answer) {
    data = await requestGeminiRecipe(apiKey, model, question, items, 8192);
    answer = extractGeminiText(data);
  }

  if (!answer) {
    throw new RecipeAssistantError('Gemini returned an empty recipe.', 502, 'EMPTY_MODEL_RESPONSE');
  }
  if (String(data?.candidates?.[0]?.finishReason || '').toUpperCase() === 'MAX_TOKENS') {
    throw new RecipeAssistantError(
      'Gemini stopped before completing the recipe.',
      502,
      'GEMINI_OUTPUT_TRUNCATED'
    );
  }

  return { answer, model };
}

async function askRecipeAssistant(provider, apiKey, question, items) {
  if (provider === 'gemini') return askGeminiRecipe(apiKey, question, items);
  if (provider === 'openai') return askOpenAIRecipe(apiKey, question, items);
  throw new RecipeAssistantError('Unsupported AI provider.', 400, 'INVALID_AI_PROVIDER');
}

module.exports = {
  RecipeAssistantError,
  askRecipeAssistant,
  isRecipeRequest,
};
