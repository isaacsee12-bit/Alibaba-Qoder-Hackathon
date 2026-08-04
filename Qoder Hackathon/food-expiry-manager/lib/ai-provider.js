const {
  askFoodAssistant: askOpenAiFoodAssistant,
  cleanItems,
  friendlyOpenAIError,
  scanFoodImage: scanFoodImageWithOpenAI,
  validateApiKey: validateOpenAiApiKey,
} = require('./openai-food');
const {
  askGeminiFoodAssistant,
  friendlyGeminiError,
  scanFoodImageWithGemini,
  validateGeminiApiKey,
} = require('./gemini-food');
const {
  askRecipeAssistant,
  isRecipeRequest,
} = require('./recipe-assistant');
const { buildContextualQuestion } = require('./assistant-conversation');

const PROVIDERS = new Set(['openai', 'gemini']);

function normalizeProvider(value, fallback = null) {
  const provider = String(value || '').trim().toLowerCase();
  return PROVIDERS.has(provider) ? provider : fallback;
}

function providerLabel(provider) {
  return normalizeProvider(provider) === 'gemini' ? 'Gemini' : 'OpenAI';
}

async function validateProviderApiKey(provider, apiKey) {
  const normalized = normalizeProvider(provider);
  if (normalized === 'gemini') return validateGeminiApiKey(apiKey);
  if (normalized === 'openai') return validateOpenAiApiKey(apiKey);
  const error = new Error('Unsupported AI provider');
  error.status = 400;
  error.code = 'INVALID_AI_PROVIDER';
  throw error;
}

async function askFoodAssistant(provider, apiKey, question, items, history = []) {
  const normalized = normalizeProvider(provider);
  if (!normalized) {
    const error = new Error('Unsupported AI provider');
    error.status = 400;
    error.code = 'INVALID_AI_PROVIDER';
    throw error;
  }

  const currentQuestion = String(question || '').trim();
  const contextualQuestion = buildContextualQuestion(currentQuestion, history);
  if (isRecipeRequest(currentQuestion)) {
    return askRecipeAssistant(normalized, apiKey, contextualQuestion, items);
  }
  if (normalized === 'gemini') return askGeminiFoodAssistant(apiKey, contextualQuestion, items);
  return askOpenAiFoodAssistant(apiKey, contextualQuestion, items);
}

async function scanFoodImage(provider, apiKey, imageDataUrl) {
  const normalized = normalizeProvider(provider);
  if (normalized === 'gemini') return scanFoodImageWithGemini(apiKey, imageDataUrl);
  if (normalized === 'openai') return scanFoodImageWithOpenAI(apiKey, imageDataUrl);
  const error = new Error('Unsupported AI provider');
  error.status = 400;
  error.code = 'INVALID_AI_PROVIDER';
  throw error;
}

function friendlyAiError(provider, error) {
  return normalizeProvider(provider) === 'gemini'
    ? friendlyGeminiError(error)
    : friendlyOpenAIError(error);
}

module.exports = {
  askFoodAssistant,
  cleanItems,
  friendlyAiError,
  normalizeProvider,
  providerLabel,
  scanFoodImage,
  validateProviderApiKey,
};