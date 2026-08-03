import { api } from './api.js';
import { toast, refreshAlertBadge } from '../app.js';
import { esc, daysUntil } from './util.js';
import { loadNutritionGoals } from './profile.js';
import { addRecipeAlert } from './recipeAlerts.js';

const PRESETS = [
  'Suggest a healthy meal using what I already have.',
];

const CHAT_STORAGE_KEY = 'fem.assistantChat';
const RECIPE_STORAGE_KEY = 'fem.generatedRecipe';

let recognition = null;
let listening = false;

function providerName(provider) {
  return provider === 'gemini' ? 'Gemini' : 'OpenAI';
}

function speak(text) {
  if (!('speechSynthesis' in window)) {
    toast('Speech playback is not supported in this browser.', 'error');
    return;
  }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.pitch = 1;
  speechSynthesis.speak(utterance);
}

function connectionLabel(status) {
  if (status?.source === 'user') {
    return `${providerName(status.provider)} connected · key ending ${status.suffix || '••••'}`;
  }
  if (status?.source === 'server') {
    return `${providerName(status.provider)} connected · Vercel server key`;
  }
  return 'Built-in recommendations · connect OpenAI or Gemini in Settings for AI';
}

/** Persist current chat messages to localStorage. */
function saveChat(messagesEl) {
  const messages = [];
  messagesEl.querySelectorAll('.assistant-message').forEach((el) => {
    const role = el.classList.contains('assistant-message-user') ? 'user' : 'bot';
    messages.push({ role, text: el.textContent });
  });
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages));
  } catch { /* storage full or unavailable */ }
}

/** Restore chat messages from localStorage. Returns true if history was loaded. */
function loadChat(messagesEl) {
  try {
    const stored = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!stored) return false;
    const messages = JSON.parse(stored);
    if (!Array.isArray(messages) || messages.length === 0) return false;
    messagesEl.innerHTML = messages.map((m) =>
      `<div class="assistant-message assistant-message-${m.role}">${esc(m.text)}</div>`
    ).join('');
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return true;
  } catch {
    return false;
  }
}

/** Extract a plausible recipe title from the first non-empty line of AI output. */
function extractRecipeTitle(text) {
  const lines = text.split('\n').filter(l => l.trim());
  for (const line of lines) {
    const clean = line.replace(/^[*#\s]+/, '').trim();
    if (clean && clean.length < 100) return clean;
  }
  return 'Generated Recipe';
}

export async function renderAssistant(view) {
  view.innerHTML = `
    <section class="assistant-hero">
      <div class="assistant-orb" aria-hidden="true">
        <span></span><span></span><span></span>
      </div>
      <div>
        <p class="assistant-kicker">Voice food assistant</p>
        <h2>Ask FreshTrack</h2>
        <p class="card-sub">Ask what to cook, what to eat first, or how to use your current inventory.</p>
      </div>
    </section>

    <p id="assistant-connection" class="card-sub">Checking AI connection…</p>

    <div class="assistant-presets" aria-label="Suggested questions">
      ${PRESETS.map((prompt) => `<button type="button" class="assistant-preset" data-prompt="${esc(prompt)}">${esc(prompt)}</button>`).join('')}
      <button type="button" class="assistant-preset assistant-preset-generate" id="btn-generate-recipe">
        <span class="generate-icon">🍳</span> Generate Recipe
      </button>
    </div>

    <section class="card assistant-chat" aria-label="Food assistant conversation">
      <div id="assistant-messages" class="assistant-messages">
        <div class="assistant-message assistant-message-bot">Press the microphone or choose a prompt to get a recommendation.</div>
      </div>
      <div class="assistant-controls">
        <textarea id="assistant-input" rows="2" placeholder="Ask about meals, expiring food, or nutrition…"></textarea>
        <div class="assistant-actions">
          <button type="button" class="btn btn-voice" id="assistant-mic" aria-label="Start voice input">🎙 Speak</button>
          <button type="button" class="btn btn-primary" id="assistant-send">Ask</button>
        </div>
      </div>
      <p id="assistant-status" class="card-sub assistant-status" aria-live="polite"></p>
    </section>
  `;

  const input = view.querySelector('#assistant-input');
  const messages = view.querySelector('#assistant-messages');
  const status = view.querySelector('#assistant-status');
  const connection = view.querySelector('#assistant-connection');
  const mic = view.querySelector('#assistant-mic');
  const send = view.querySelector('#assistant-send');
  const generateBtn = view.querySelector('#btn-generate-recipe');

  // Restore chat history from previous session
  const hasHistory = loadChat(messages);
  if (hasHistory) {
    status.textContent = 'Chat history restored.';
  }

  try {
    connection.textContent = connectionLabel(await api.getAiKeyStatus({ silent: true }));
  } catch {
    connection.textContent = 'Could not check the AI connection. Built-in recommendations remain available.';
  }

  async function submit(prompt) {
    const question = String(prompt || input.value).trim();
    if (!question) return;
    input.value = '';
    messages.insertAdjacentHTML('beforeend', `<div class="assistant-message assistant-message-user">${esc(question)}</div>`);
    messages.scrollTop = messages.scrollHeight;
    saveChat(messages);
    send.disabled = true;
    mic.disabled = true;
    generateBtn.disabled = true;
    status.textContent = 'Checking your inventory and preparing a recommendation…';
    try {
      const inventory = await api.getItems('active', { silent: true });
      const result = await api.askAssistant({ question, items: inventory.items || [] });
      const answer = result.answer || 'I could not prepare a recommendation.';
      messages.insertAdjacentHTML('beforeend', `<div class="assistant-message assistant-message-bot">${esc(answer)}</div>`);
      messages.scrollTop = messages.scrollHeight;
      saveChat(messages);
      if (result.ai) {
        const provider = providerName(result.provider);
        status.textContent = result.keySource === 'user'
          ? `${provider} response · spoken aloud`
          : `${provider} server response · spoken aloud`;
      } else if (result.warning) {
        status.textContent = `${result.warning} Built-in recommendation used instead.`;
      } else {
        status.textContent = 'Built-in recommendation · spoken aloud';
      }
      speak(answer);
    } catch {
      status.textContent = 'Could not reach the food assistant.';
    } finally {
      send.disabled = false;
      mic.disabled = false;
      generateBtn.disabled = false;
    }
  }

  async function generateRecipe() {
    // Show user intent in chat
    messages.insertAdjacentHTML('beforeend', `<div class="assistant-message assistant-message-user">🍳 Generate a recipe using my available ingredients</div>`);
    messages.scrollTop = messages.scrollHeight;
    saveChat(messages);
    send.disabled = true;
    mic.disabled = true;
    generateBtn.disabled = true;
    status.textContent = 'Checking your inventory and preparing a recipe…';

    try {
      const data = await api.getItems('active', { silent: true });
      const items = data.items || [];

      if (items.length === 0) {
        const msg = 'Your inventory is empty. Add some food items first, then I can generate a recipe for you!';
        messages.insertAdjacentHTML('beforeend', `<div class="assistant-message assistant-message-bot">${msg}</div>`);
        messages.scrollTop = messages.scrollHeight;
        saveChat(messages);
        status.textContent = 'No inventory items found.';
        return;
      }

      // Filter out expired items, sort by closest expiry first
      const usable = items
        .filter((item) => {
          if (!item.expiresAt) return true;
          const d = daysUntil(item.expiresAt);
          return d !== null && d >= 0;
        })
        .sort((a, b) => {
          const da = a.expiresAt ? new Date(a.expiresAt).getTime() : Infinity;
          const db = b.expiresAt ? new Date(b.expiresAt).getTime() : Infinity;
          return da - db;
        });

      const itemList = usable.map((item) => {
        const expiry = item.expiresAt
          ? ` (expires in ${daysUntil(item.expiresAt)} days)`
          : '';
        return `${item.name}${expiry}`;
      });

      // Nutrition goals from the Profile section of the Settings page.
      const goals = loadNutritionGoals();
      const goalPrompt = goals.length
        ? `Nutrition goals: ${goals.join(', ')} — tailor the recipe to satisfy these goals as much as possible with the available ingredients; if a goal cannot be fully met, get as close as possible. `
        : '';

      const prompt = `Generate a detailed recipe using ONLY the ingredients listed below — this is all the food currently available in my pantry. Do NOT include or suggest any ingredient that is not in this list, so I do not need to buy anything extra. Prioritize the ingredients that are closest to their expiry date. Do NOT use any expired ingredients. ${goalPrompt}Provide the recipe title, list of ingredients with quantities, and step-by-step cooking instructions. Available ingredients: ${itemList.join(', ')}`;

      const result = await api.askAssistant({ question: prompt, items: usable, goals });
      const answer = result.answer || 'I could not prepare a recipe. Please try again.';

      messages.insertAdjacentHTML('beforeend', `<div class="assistant-message assistant-message-bot">${esc(answer)}</div>`);
      messages.scrollTop = messages.scrollHeight;
      saveChat(messages);

      // Keep the latest recipe in localStorage for reference (recipe alerts store their own copy)
      const recipe = {
        title: extractRecipeTitle(answer),
        fullText: answer,
        usesItems: usable.slice(0, 10).map((i) => i.name),
        timestamp: new Date().toISOString(),
        ai: result.ai,
        provider: result.provider,
      };
      try {
        localStorage.setItem(RECIPE_STORAGE_KEY, JSON.stringify(recipe));
      } catch { /* storage unavailable */ }

      // Create a new Recipe alert (nav badge increments for the unread one)
      addRecipeAlert(recipe);
      refreshAlertBadge();

      if (result.ai) {
        const provider = providerName(result.provider);
        status.textContent = result.keySource === 'user'
          ? `${provider} recipe generated · spoken aloud`
          : `${provider} server recipe · spoken aloud`;
      } else if (result.warning) {
        status.textContent = `${result.warning} Built-in recipe used instead.`;
      } else {
        status.textContent = 'Built-in recipe · spoken aloud';
      }
      speak(answer);
    } catch {
      status.textContent = 'Could not generate a recipe.';
    } finally {
      send.disabled = false;
      mic.disabled = false;
      generateBtn.disabled = false;
    }
  }

  view.querySelectorAll('.assistant-preset[data-prompt]').forEach((button) => {
    button.addEventListener('click', () => submit(button.dataset.prompt));
  });
  generateBtn.addEventListener('click', generateRecipe);
  send.addEventListener('click', () => submit());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    mic.disabled = true;
    mic.textContent = 'Voice unavailable';
    status.textContent = 'Voice input is not supported here. You can still type a question.';
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = navigator.language || 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onstart = () => {
    listening = true;
    mic.classList.add('listening');
    mic.textContent = 'Listening…';
    status.textContent = 'Speak now.';
  };
  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    input.value = transcript;
    submit(transcript);
  };
  recognition.onerror = () => {
    status.textContent = 'Voice input stopped. Try again or type your question.';
  };
  recognition.onend = () => {
    listening = false;
    mic.classList.remove('listening');
    mic.textContent = '🎙 Speak';
  };
  mic.addEventListener('click', () => {
    if (listening) recognition.stop();
    else recognition.start();
  });
}
