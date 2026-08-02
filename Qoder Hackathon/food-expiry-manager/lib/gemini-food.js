const crypto = require('crypto');

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const REQUEST_TIMEOUT_MS = 20000;
const MODEL_CACHE_TTL_MS = 10 * 60 * 1000;
const MODEL_PREFERENCES = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-flash-latest',
];
const modelCache = new Map();

const CATEGORIES = [
  'fruit',
  'vegetable',
  'dairy',
  'meat',
  'grain',
  'seafood',
  'snack',
  'beverage',
  'other',
];

class GeminiRequestError extends Error {
  constructor(message, status, code, details = null) {
    super(message);
    this.name = 'GeminiRequestError';
    this.status = status || 502;
    this.code = code || 'GEMINI_REQUEST_FAILED';
    this.details = details;
  }
}

function modelName(value, fallback = null) {
  const model = String(value || '').trim().replace(/^models\//, '');
  return /^[a-zA-Z0-9._-]+$/.test(model) ? model : fallback;
}

function keyFingerprint(apiKey) {
  return crypto.createHash('sha256').update(String(apiKey), 'utf8').digest('hex').slice(0, 20);
}

function extractText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => String(part?.text || '')).join('').trim();
}

function finishReason(data) {
  return String(data?.candidates?.[0]?.finishReason || '').trim().toUpperCase();
}

function responseWasTruncated(data) {
  return finishReason(data) === 'MAX_TOKENS';
}

function looksIncompleteAnswer(value) {
  const answer = String(value || '').trim();
  if (!answer) return true;
  if (/[,:;\-–—]$/.test(answer)) return true;
  const openParens = (answer.match(/\(/g) || []).length;
  const closeParens = (answer.match(/\)/g) || []).length;
  return openParens !== closeParens;
}

function withLowThinking(payload, selectedModel) {
  const generationConfig = { ...(payload?.generationConfig || {}) };
  if (/^gemini-3(?:\.|-)/i.test(selectedModel)) {
    generationConfig.thinkingConfig = { thinkingLevel: 'LOW' };
  } else if (/^gemini-2\.5-(?:flash|flash-lite)/i.test(selectedModel)) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }
  return { ...payload, generationConfig };
}

function errorReason(data) {
  const details = Array.isArray(data?.error?.details) ? data.error.details : [];
  return details.find((item) => item?.reason)?.reason
    || data?.error?.status
    || 'GEMINI_REQUEST_FAILED';
}

async function fetchJson(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
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
      throw new GeminiRequestError(
        'The Gemini request timed out before Google responded.',
        504,
        'GEMINI_TIMEOUT'
      );
    }
    throw new GeminiRequestError(
      'The server could not reach the Gemini API.',
      502,
      'GEMINI_NETWORK_ERROR',
      error?.message || null
    );
  } finally {
    clearTimeout(timer);
  }
}

function throwResponseError(response, data) {
  const message = data?.error?.message || `Gemini request failed (${response.status})`;
  throw new GeminiRequestError(message, response.status, errorReason(data), data?.error?.details || null);
}

function availableGenerationModels(data) {
  return (Array.isArray(data?.models) ? data.models : [])
    .filter((entry) => (entry.supportedGenerationMethods || entry.supportedActions || []).includes('generateContent'))
    .map((entry) => modelName(entry.name || entry.baseModelId))
    .filter(Boolean);
}

function scoreModel(name, preferred) {
  if (preferred && name === preferred) return -1000;
  const index = MODEL_PREFERENCES.indexOf(name);
  if (index >= 0) return index;
  if (/flash/i.test(name) && !/(live|tts|image|audio|preview|exp)/i.test(name)) return 100;
  if (!/(live|tts|image|audio|embedding|preview|exp)/i.test(name)) return 200;
  return 1000;
}

function retryDelay(attempt) {
  return new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
}

function isTransientStatus(status) {
  return status === 500 || status === 502 || status === 503 || status === 504;
}

async function listGeminiModels(apiKey) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { response, data } = await fetchJson(`${API_BASE}/models?pageSize=1000`, {
        method: 'GET',
        headers: { 'x-goog-api-key': apiKey },
      });
      if (response.ok) return data;
      if (!isTransientStatus(response.status) || attempt === 2) throwResponseError(response, data);
      lastError = new GeminiRequestError(
        data?.error?.message || `Gemini model discovery failed (${response.status})`,
        response.status,
        errorReason(data),
        data?.error?.details || null
      );
    } catch (error) {
      lastError = error;
      if (!['GEMINI_TIMEOUT', 'GEMINI_NETWORK_ERROR'].includes(error?.code) || attempt === 2) throw error;
    }
    await retryDelay(attempt);
  }
  throw lastError || new GeminiRequestError('Gemini model discovery failed.', 502, 'GEMINI_MODEL_DISCOVERY_FAILED');
}

async function discoverGeminiModel(apiKey, preferredModel = null, excluded = new Set()) {
  const preferred = modelName(preferredModel);
  const fingerprint = keyFingerprint(apiKey);
  const cached = modelCache.get(fingerprint);
  if (cached && cached.expiresAt > Date.now() && !excluded.has(cached.model)) {
    return cached.model;
  }

  const data = await listGeminiModels(apiKey);
  const models = availableGenerationModels(data)
    .filter((name) => !excluded.has(name))
    .sort((a, b) => scoreModel(a, preferred) - scoreModel(b, preferred));

  if (!models.length) {
    throw new GeminiRequestError(
      'This API key has no Gemini model that supports generateContent.',
      404,
      'NO_COMPATIBLE_GEMINI_MODEL'
    );
  }

  const selected = models[0];
  modelCache.set(fingerprint, {
    model: selected,
    expiresAt: Date.now() + MODEL_CACHE_TTL_MS,
  });
  return selected;
}

function clearCachedModel(apiKey) {
  modelCache.delete(keyFingerprint(apiKey));
}

async function generateWithModel(apiKey, selectedModel, payload) {
  const url = `${API_BASE}/models/${encodeURIComponent(selectedModel)}:generateContent`;
  const requestPayload = withLowThinking(payload, selectedModel);
  let lastError;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { response, data } = await fetchJson(url, {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestPayload),
      });
      if (response.ok) return { data, model: selectedModel };
      if (!isTransientStatus(response.status) || attempt === 2) throwResponseError(response, data);
      lastError = new GeminiRequestError(
        data?.error?.message || `Gemini request failed (${response.status})`,
        response.status,
        errorReason(data),
        data?.error?.details || null
      );
    } catch (error) {
      lastError = error;
      if (!['GEMINI_TIMEOUT', 'GEMINI_NETWORK_ERROR'].includes(error?.code) || attempt === 2) throw error;
    }
    await retryDelay(attempt);
  }

  throw lastError || new GeminiRequestError('Gemini request failed.', 502, 'GEMINI_REQUEST_FAILED');
}

async function requestGemini(apiKey, preferredModel, payload) {
  let selectedModel = await discoverGeminiModel(apiKey, preferredModel);
  try {
    return await generateWithModel(apiKey, selectedModel, payload);
  } catch (error) {
    const code = String(error?.code || '').toUpperCase();
    if (error?.status !== 404 && !code.includes('NOT_FOUND') && !code.includes('MODEL_NOT_FOUND')) {
      throw error;
    }

    clearCachedModel(apiKey);
    selectedModel = await discoverGeminiModel(apiKey, preferredModel, new Set([selectedModel]));
    return generateWithModel(apiKey, selectedModel, payload);
  }
}

function friendlyGeminiError(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '');

  if (error?.status === 401 || code.includes('UNAUTHENTICATED')) {
    return 'The Gemini API key was rejected. Create a new key in Google AI Studio and connect it again.';
  }
  if (error?.status === 400 && (code.includes('API_KEY_INVALID') || /api key.*invalid/i.test(message))) {
    return 'The Gemini API key was rejected. Create a new key in Google AI Studio and connect it again.';
  }
  if (code.includes('FAILED_PRECONDITION') || /free tier|billing|country|region/i.test(message)) {
    return `Gemini cannot run for this Google project yet. ${message}`.slice(0, 500);
  }
  if (error?.status === 403 || code.includes('PERMISSION_DENIED')) {
    return 'This Gemini API key does not have permission to use Gemini. Check the key restrictions and project access in Google AI Studio.';
  }
  if (error?.status === 404 || code.includes('NOT_FOUND') || code.includes('MODEL_NOT_FOUND')) {
    return 'No compatible Gemini generateContent model is available to this API key. Check the project, region, and model access in Google AI Studio.';
  }
  if (error?.status === 429 || code.includes('RESOURCE_EXHAUSTED') || code.includes('QUOTA')) {
    return 'The Gemini key has reached a quota or rate limit. Check its limits and billing in Google AI Studio.';
  }
  if (code === 'GEMINI_TIMEOUT') {
    return 'Gemini did not respond in time. Try connecting again.';
  }
  if (code === 'GEMINI_NETWORK_ERROR') {
    return 'FreshTrack could not reach Google’s Gemini API from the server. Try again after the deployment finishes.';
  }
  if (code === 'GEMINI_OUTPUT_TRUNCATED') {
    return 'Gemini could not finish the recommendation. FreshTrack used the built-in complete recommendation instead.';
  }
  if (error?.status === 400) return message || 'The Gemini request was not accepted.';
  if (error?.status === 500 || error?.status === 503) {
    return 'Google Gemini is temporarily overloaded. FreshTrack retried the request, but Google did not recover.';
  }
  return message ? `Gemini request failed: ${message}`.slice(0, 500) : 'The Gemini request failed for an unknown reason.';
}

async function validateGeminiApiKey(apiKey) {
  const { data, model } = await requestGemini(
    apiKey,
    process.env.GEMINI_MODEL,
    {
      contents: [{
        role: 'user',
        parts: [{ text: 'Reply with only the word OK.' }],
      }],
      generationConfig: {
        maxOutputTokens: 128,
      },
    }
  );
  const answer = extractText(data);
  if (!answer) throw new GeminiRequestError('Gemini returned an empty response', 502, 'EMPTY_MODEL_RESPONSE');
  return { ok: true, model };
}

function cleanItems(items) {
  return (Array.isArray(items) ? items : [])
    .slice(0, 40)
    .map((item) => ({
      name: String(item?.name || '').slice(0, 80),
      category: String(item?.category || 'other').slice(0, 40),
      quantity: item?.quantity ?? null,
      unit: item?.unit ?? null,
      expiresAt: item?.expiresAt || null,
    }))
    .filter((item) => item.name);
}

function askPayload(inventoryText, question, maxOutputTokens) {
  return {
    systemInstruction: {
      parts: [{
        text: 'You are FreshTrack, a concise food inventory assistant. Give practical meal and food-waste recommendations based only on the supplied inventory. Mention food-safety uncertainty and never claim an item is safe solely from its date. Keep the answer under 90 words. Use complete sentences, finish the final sentence, and never stop after a comma, dash, colon, or unfinished date.',
      }],
    },
    contents: [{
      role: 'user',
      parts: [{
        text: `Inventory: ${inventoryText}\n\nUser question: ${String(question).slice(0, 600)}`,
      }],
    }],
    generationConfig: {
      maxOutputTokens,
    },
  };
}

async function askGeminiFoodAssistant(apiKey, question, items) {
  const clean = cleanItems(items);
  const inventoryText = clean.length
    ? clean.map((item) => `${item.name}${item.quantity != null ? ` (${item.quantity} ${item.unit || ''})` : ''}${item.expiresAt ? `, expires ${String(item.expiresAt).slice(0, 10)}` : ''}`).join('; ')
    : 'No inventory items available.';

  const preferred = process.env.GEMINI_MODEL;
  let response = await requestGemini(
    apiKey,
    preferred,
    askPayload(inventoryText, question, 1024)
  );
  let answer = extractText(response.data);

  if (responseWasTruncated(response.data) || looksIncompleteAnswer(answer)) {
    response = await requestGemini(
      apiKey,
      preferred,
      askPayload(inventoryText, question, 2048)
    );
    answer = extractText(response.data);
  }

  if (!answer) {
    throw new GeminiRequestError('Gemini returned an empty answer', 502, 'EMPTY_MODEL_RESPONSE');
  }
  if (responseWasTruncated(response.data) || looksIncompleteAnswer(answer)) {
    throw new GeminiRequestError(
      'Gemini stopped before completing the recommendation.',
      502,
      'GEMINI_OUTPUT_TRUNCATED',
      { finishReason: finishReason(response.data) || null }
    );
  }

  return { answer, model: response.model };
}

function parseImageDataUrl(value) {
  const image = String(value || '');
  const match = image.match(/^data:image\/(jpeg|jpg|png|webp);base64,([a-zA-Z0-9+/=\s]+)$/i);
  if (!match) {
    const error = new Error('imageDataUrl must be a JPEG, PNG, or WebP data URL');
    error.status = 400;
    error.code = 'INVALID_IMAGE';
    throw error;
  }
  if (image.length > 2_800_000) {
    const error = new Error('The image is too large. Choose a smaller image and try again.');
    error.status = 413;
    error.code = 'IMAGE_TOO_LARGE';
    throw error;
  }
  const extension = match[1].toLowerCase();
  return {
    mimeType: extension === 'jpg' ? 'image/jpeg' : `image/${extension}`,
    data: match[2].replace(/\s/g, ''),
  };
}

function normalizeScanResult(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const confidence = Number(raw.confidence);
  const shelfDays = Number(raw.shelfDays);
  return {
    name: String(raw.name || 'unknown food').trim().slice(0, 80).toLowerCase(),
    category: CATEGORIES.includes(raw.category) ? raw.category : 'other',
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.65,
    shelfDays: Number.isFinite(shelfDays) ? Math.min(60, Math.max(1, Math.round(shelfDays))) : 7,
    alternatives: (Array.isArray(raw.alternatives) ? raw.alternatives : [])
      .map((item) => String(item).trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 3),
  };
}

function scanSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string' },
      category: { type: 'string', enum: CATEGORIES },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      shelfDays: { type: 'integer', minimum: 1, maximum: 60 },
      alternatives: {
        type: 'array',
        maxItems: 3,
        items: { type: 'string' },
      },
    },
    required: ['name', 'category', 'confidence', 'shelfDays', 'alternatives'],
  };
}

function scanPayload(image, modernFormat = true) {
  const generationConfig = { maxOutputTokens: 1024 };
  const schema = scanSchema();
  if (modernFormat) {
    generationConfig.responseFormat = {
      text: {
        mimeType: 'application/json',
        schema,
      },
    };
  } else {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseJsonSchema = schema;
  }

  return {
    systemInstruction: {
      parts: [{
        text: 'Identify the main food item in the image for a food-expiry inventory app. Use a short generic food name, select the closest category, estimate confidence from 0 to 1, and give a conservative typical refrigerator shelf-life estimate in whole days. Do not infer that food is safe to eat from appearance or date alone.',
      }],
    },
    contents: [{
      role: 'user',
      parts: [
        {
          inlineData: {
            mimeType: image.mimeType,
            data: image.data,
          },
        },
        { text: 'Identify the main food item and return the required structured result.' },
      ],
    }],
    generationConfig,
  };
}

async function scanFoodImageWithGemini(apiKey, imageDataUrl) {
  const image = parseImageDataUrl(imageDataUrl);
  const preferred = process.env.GEMINI_VISION_MODEL || process.env.GEMINI_MODEL;
  let response;

  try {
    response = await requestGemini(apiKey, preferred, scanPayload(image, true));
  } catch (error) {
    const code = String(error?.code || '').toUpperCase();
    const formatRejected = error?.status === 400
      && (code.includes('INVALID_ARGUMENT') || /response.?format|unknown.*parameter/i.test(error?.message || ''));
    if (!formatRejected) throw error;
    response = await requestGemini(apiKey, preferred, scanPayload(image, false));
  }

  const output = extractText(response.data);
  if (!output) throw new GeminiRequestError('Gemini returned no scan result', 502, 'EMPTY_MODEL_RESPONSE');

  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new GeminiRequestError('Gemini returned an invalid scan result', 502, 'INVALID_MODEL_RESPONSE');
  }

  return {
    ...normalizeScanResult(parsed),
    model: response.model,
  };
}

module.exports = {
  GeminiRequestError,
  askGeminiFoodAssistant,
  discoverGeminiModel,
  friendlyGeminiError,
  scanFoodImageWithGemini,
  validateGeminiApiKey,
};
