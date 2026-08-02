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
  constructor(message, status, code) {
    super(message);
    this.name = 'GeminiRequestError';
    this.status = status || 502;
    this.code = code || 'GEMINI_REQUEST_FAILED';
  }
}

function modelName(value, fallback) {
  const model = String(value || fallback).trim();
  return /^[a-zA-Z0-9._-]+$/.test(model) ? model : fallback;
}

function extractText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => String(part?.text || '')).join('').trim();
}

async function requestGemini(apiKey, model, payload) {
  const selectedModel = modelName(model, 'gemini-2.5-flash');
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selectedModel)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );

  let data;
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    const message = data?.error?.message || `Gemini request failed (${response.status})`;
    const code = data?.error?.status || data?.error?.details?.[0]?.reason || 'GEMINI_REQUEST_FAILED';
    throw new GeminiRequestError(message, response.status, code);
  }
  return { data, model: selectedModel };
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
  if (error?.status === 403 || code.includes('PERMISSION_DENIED')) {
    return 'This Gemini API key does not have permission to use the selected model.';
  }
  if (error?.status === 429 || code.includes('RESOURCE_EXHAUSTED')) {
    return 'The Gemini key has reached a quota or rate limit. Check its limits in Google AI Studio.';
  }
  if (error?.status === 400) return message || 'The Gemini request was not accepted.';
  return 'The Gemini service is temporarily unavailable.';
}

async function validateGeminiApiKey(apiKey) {
  const { data } = await requestGemini(
    apiKey,
    process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    {
      contents: [{
        role: 'user',
        parts: [{ text: 'Reply with only the word OK.' }],
      }],
      generationConfig: {
        maxOutputTokens: 8,
      },
    }
  );
  const answer = extractText(data);
  if (!answer) throw new GeminiRequestError('Gemini returned an empty response', 502, 'EMPTY_MODEL_RESPONSE');
  return true;
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

async function askGeminiFoodAssistant(apiKey, question, items) {
  const clean = cleanItems(items);
  const inventoryText = clean.length
    ? clean.map((item) => `${item.name}${item.quantity != null ? ` (${item.quantity} ${item.unit || ''})` : ''}${item.expiresAt ? `, expires ${String(item.expiresAt).slice(0, 10)}` : ''}`).join('; ')
    : 'No inventory items available.';

  const selectedModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const { data, model } = await requestGemini(apiKey, selectedModel, {
    systemInstruction: {
      parts: [{
        text: 'You are FreshTrack, a concise food inventory assistant. Give practical meal and food-waste recommendations based only on the supplied inventory. Mention food-safety uncertainty and never claim an item is safe solely from its date. Keep the answer under 90 words and suitable for spoken playback.',
      }],
    },
    contents: [{
      role: 'user',
      parts: [{
        text: `Inventory: ${inventoryText}\n\nUser question: ${String(question).slice(0, 600)}`,
      }],
    }],
    generationConfig: {
      maxOutputTokens: 240,
    },
  });

  const answer = extractText(data);
  if (!answer) throw new GeminiRequestError('Gemini returned an empty answer', 502, 'EMPTY_MODEL_RESPONSE');
  return { answer, model };
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

async function scanFoodImageWithGemini(apiKey, imageDataUrl) {
  const image = parseImageDataUrl(imageDataUrl);
  const selectedModel = process.env.GEMINI_VISION_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const schema = {
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

  const { data, model } = await requestGemini(apiKey, selectedModel, {
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
        {
          text: 'Identify the main food item and return the required structured result.',
        },
      ],
    }],
    generationConfig: {
      maxOutputTokens: 220,
      responseMimeType: 'application/json',
      responseJsonSchema: schema,
    },
  });

  const output = extractText(data);
  if (!output) throw new GeminiRequestError('Gemini returned no scan result', 502, 'EMPTY_MODEL_RESPONSE');

  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new GeminiRequestError('Gemini returned an invalid scan result', 502, 'INVALID_MODEL_RESPONSE');
  }

  return {
    ...normalizeScanResult(parsed),
    model,
  };
}

module.exports = {
  GeminiRequestError,
  askGeminiFoodAssistant,
  friendlyGeminiError,
  scanFoodImageWithGemini,
  validateGeminiApiKey,
};
