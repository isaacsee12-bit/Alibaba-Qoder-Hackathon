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

class OpenAIRequestError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'OpenAIRequestError';
    this.status = status || 502;
    this.code = code || 'OPENAI_REQUEST_FAILED';
  }
}

function extractText(data) {
  if (typeof data?.output_text === 'string') return data.output_text.trim();
  for (const output of data?.output || []) {
    for (const content of output?.content || []) {
      if (content?.type === 'output_text' && content?.text) return String(content.text).trim();
    }
  }
  return '';
}

async function requestOpenAI(apiKey, payload) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  let data;
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    const message = data?.error?.message || `OpenAI request failed (${response.status})`;
    const code = data?.error?.code || data?.error?.type || 'OPENAI_REQUEST_FAILED';
    throw new OpenAIRequestError(message, response.status, code);
  }
  return data;
}

function friendlyOpenAIError(error) {
  if (error?.status === 401) return 'The API key was rejected. Create a new OpenAI API key and connect it again.';
  if (error?.status === 403) return 'This API key does not have permission to use the selected model.';
  if (error?.status === 429 && String(error?.code).includes('quota')) {
    return 'The API key has no available credits or has reached its spending limit.';
  }
  if (error?.status === 429) return 'The AI service is rate-limited. Try again shortly.';
  if (error?.status === 400) return error.message || 'The AI request was not accepted.';
  return 'The AI service is temporarily unavailable.';
}

async function validateApiKey(apiKey) {
  await requestOpenAI(apiKey, {
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',
    store: false,
    max_output_tokens: 16,
    input: 'Reply with only the word OK.',
  });
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

async function askFoodAssistant(apiKey, question, items) {
  const clean = cleanItems(items);
  const inventoryText = clean.length
    ? clean.map((item) => `${item.name}${item.quantity != null ? ` (${item.quantity} ${item.unit || ''})` : ''}${item.expiresAt ? `, expires ${String(item.expiresAt).slice(0, 10)}` : ''}`).join('; ')
    : 'No inventory items available.';

  const data = await requestOpenAI(apiKey, {
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',
    store: false,
    max_output_tokens: 240,
    instructions: 'You are FreshTrack, a concise food inventory assistant. Give practical meal and food-waste recommendations based only on the supplied inventory. Mention food-safety uncertainty and never claim an item is safe solely from its date. Keep the answer under 90 words and suitable for spoken playback.',
    input: `Inventory: ${inventoryText}\n\nUser question: ${String(question).slice(0, 600)}`,
  });

  const answer = extractText(data);
  if (!answer) throw new OpenAIRequestError('The model returned an empty answer', 502, 'EMPTY_MODEL_RESPONSE');
  return {
    answer,
    model: data?.model || process.env.OPENAI_MODEL || 'gpt-5-mini',
  };
}

function validateImageDataUrl(value) {
  const image = String(value || '');
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(image)) {
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
  return image;
}

function normalizeScanResult(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const confidence = Number(raw.confidence);
  const shelfDays = Number(raw.shelfDays);
  const category = CATEGORIES.includes(raw.category) ? raw.category : 'other';
  return {
    name: String(raw.name || 'unknown food').trim().slice(0, 80).toLowerCase(),
    category,
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.65,
    shelfDays: Number.isFinite(shelfDays) ? Math.min(60, Math.max(1, Math.round(shelfDays))) : 7,
    alternatives: (Array.isArray(raw.alternatives) ? raw.alternatives : [])
      .map((item) => String(item).trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 3),
  };
}

async function scanFoodImage(apiKey, imageDataUrl) {
  const image = validateImageDataUrl(imageDataUrl);
  const data = await requestOpenAI(apiKey, {
    model: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || 'gpt-5-mini',
    store: false,
    max_output_tokens: 220,
    instructions: 'Identify the main food item in the image for a food-expiry inventory app. Use a short generic food name, select the closest category, estimate confidence from 0 to 1, and give a conservative typical refrigerator shelf-life estimate in whole days. Do not infer that food is safe to eat from appearance or date alone.',
    input: [{
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: 'Identify the main food item. Return the required structured result.',
        },
        {
          type: 'input_image',
          image_url: image,
          detail: 'low',
        },
      ],
    }],
    text: {
      format: {
        type: 'json_schema',
        name: 'food_scan',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            category: { type: 'string', enum: CATEGORIES },
            confidence: { type: 'number' },
            shelfDays: { type: 'integer' },
            alternatives: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['name', 'category', 'confidence', 'shelfDays', 'alternatives'],
        },
      },
    },
  });

  const output = extractText(data);
  if (!output) throw new OpenAIRequestError('The model returned no scan result', 502, 'EMPTY_MODEL_RESPONSE');

  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new OpenAIRequestError('The model returned an invalid scan result', 502, 'INVALID_MODEL_RESPONSE');
  }

  return {
    ...normalizeScanResult(parsed),
    model: data?.model || process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || 'gpt-5-mini',
  };
}

module.exports = {
  OpenAIRequestError,
  askFoodAssistant,
  cleanItems,
  friendlyOpenAIError,
  scanFoodImage,
  validateApiKey,
  validateImageDataUrl,
};
