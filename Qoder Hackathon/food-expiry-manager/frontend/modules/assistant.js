import { api } from './api.js';
import { toast, refreshAlertBadge } from '../app.js';
import { esc, daysUntil } from './util.js';
import { loadNutritionGoals } from './profile.js';
import { addRecipeAlert } from './recipeAlerts.js';

const QUICK_PROMPTS = [
  {
    icon: '⏳',
    label: 'Expiring soon',
    prompt: 'What should I cook today using food that expires soon?',
  },
  {
    icon: '🥗',
    label: 'Healthy meal',
    prompt: 'Suggest a healthy meal using what I already have.',
  },
  {
    icon: '⚡',
    label: '15-minute meal',
    prompt: 'Suggest a meal I can make in 15 minutes using my current inventory.',
  },
  {
    icon: '💪',
    label: 'High protein',
    prompt: 'Suggest a high-protein meal using food I already have.',
  },
];

const CHAT_STORAGE_KEY = 'fem.assistantChat';
const RECIPE_STORAGE_KEY = 'fem.generatedRecipe';
const MAX_STORED_MESSAGES = 80;

let recognition = null;
let listening = false;
let pending = false;
let chatMessages = [];
let inventoryCache = [];
let lastQuestion = '';
let messageCounter = 0;

function providerName(provider) {
  return provider === 'gemini' ? 'Gemini' : 'OpenAI';
}

function connectionMeta(status) {
  if (status?.source === 'user' || status?.source === 'server') {
    return {
      connected: true,
      label: `${providerName(status.provider)} connected`,
      detail: status.source === 'server' ? 'Server key' : 'Personal key',
    };
  }
  return {
    connected: false,
    label: 'Built-in mode',
    detail: 'Connect AI in Settings',
  };
}

function speak(text) {
  if (!('speechSynthesis' in window)) {
    toast('Speech playback is not supported in this browser.', 'error');
    return;
  }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(String(text || ''));
  utterance.rate = 1;
  utterance.pitch = 1;
  speechSynthesis.speak(utterance);
}

async function copyText(text) {
  const value = String(text || '');
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }
  toast('Copied to clipboard.', 'success');
}

function nextMessageId() {
  messageCounter += 1;
  return `ask-${Date.now().toString(36)}-${messageCounter.toString(36)}`;
}

function normalizeStoredMessage(message) {
  if (!message || !['user', 'bot'].includes(message.role)) return null;
  const text = String(message.text || '').trim();
  if (!text) return null;
  return {
    id: String(message.id || nextMessageId()),
    role: message.role,
    kind: message.kind === 'recipe' ? 'recipe' : 'text',
    text,
    prompt: String(message.prompt || ''),
    createdAt: message.createdAt || new Date().toISOString(),
    provider: message.provider || null,
    recipe: message.recipe && typeof message.recipe === 'object' ? message.recipe : null,
  };
}

function loadChatState() {
  try {
    const stored = JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) || '[]');
    if (!Array.isArray(stored)) return [];
    return stored.map(normalizeStoredMessage).filter(Boolean).slice(-MAX_STORED_MESSAGES);
  } catch {
    return [];
  }
}

function persistChatState() {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chatMessages.slice(-MAX_STORED_MESSAGES)));
  } catch {
    // Storage may be unavailable or full. The current session remains usable.
  }
}

function cleanMarkdown(value) {
  return String(value || '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*•]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/^\*\*(.+)\*\*:?$/, '$1')
    .trim();
}

function extractRecipeTitle(text) {
  const lines = String(text || '').split(/\r?\n/).map(cleanMarkdown).filter(Boolean);
  const first = lines[0] || 'Generated Recipe';
  return first.length <= 100 ? first : 'Generated Recipe';
}

function inlineMarkup(text) {
  return esc(String(text || ''))
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function richTextHtml(text) {
  const lines = String(text || '').split(/\r?\n/);
  const html = [];
  let listType = null;

  const closeList = () => {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      closeList();
      continue;
    }

    const heading = line.match(/^#{1,4}\s+(.+)$/);
    if (heading) {
      closeList();
      html.push(`<h4>${inlineMarkup(heading[1])}</h4>`);
      continue;
    }

    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      if (listType !== 'ul') {
        closeList();
        listType = 'ul';
        html.push('<ul>');
      }
      html.push(`<li>${inlineMarkup(bullet[1])}</li>`);
      continue;
    }

    const numbered = line.match(/^\d+[.)]\s+(.+)$/);
    if (numbered) {
      if (listType !== 'ol') {
        closeList();
        listType = 'ol';
        html.push('<ol>');
      }
      html.push(`<li>${inlineMarkup(numbered[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${inlineMarkup(line)}</p>`);
  }

  closeList();
  return html.join('');
}

function parseRecipe(text, usesItems = []) {
  const rawLines = String(text || '').split(/\r?\n/);
  const nonEmpty = rawLines.map((line) => line.trim()).filter(Boolean);
  const title = extractRecipeTitle(text);
  const ingredients = [];
  const steps = [];
  const notes = [];
  const summary = [];
  let section = 'summary';
  let titleSkipped = false;

  for (const raw of nonEmpty) {
    const clean = cleanMarkdown(raw);
    if (!clean) continue;

    if (!titleSkipped && clean.toLowerCase() === title.toLowerCase()) {
      titleSkipped = true;
      continue;
    }

    const sectionName = clean.toLowerCase().replace(/:$/, '');
    if (/^(ingredients|what you need|you will need)$/.test(sectionName)) {
      section = 'ingredients';
      continue;
    }
    if (/^(instructions|method|steps|directions|how to make it|preparation)$/.test(sectionName)) {
      section = 'steps';
      continue;
    }
    if (/^(notes|tips|serving suggestion|food safety note)$/.test(sectionName)) {
      section = 'notes';
      continue;
    }

    if (section === 'ingredients') ingredients.push(clean);
    else if (section === 'steps') steps.push(clean);
    else if (section === 'notes') notes.push(clean);
    else summary.push(clean);
  }

  return {
    title,
    summary: summary.slice(0, 3).join(' '),
    ingredients: ingredients.slice(0, 24),
    steps: steps.slice(0, 20),
    notes: notes.slice(0, 6),
    fullText: String(text || '').trim(),
    usesItems: Array.from(new Set(usesItems.map((item) => String(item || '').trim()).filter(Boolean))).slice(0, 12),
    timestamp: new Date().toISOString(),
    saved: false,
  };
}

function messageActionButton(action, icon, label, extraClass = '') {
  return `<button type="button" class="assistant-message-action ${extraClass}" data-message-action="${action}"><span aria-hidden="true">${icon}</span>${label}</button>`;
}

function recipeCardHtml(message) {
  const recipe = message.recipe || parseRecipe(message.text);
  const hasStructuredSections = recipe.ingredients?.length || recipe.steps?.length;
  const usesCount = recipe.usesItems?.length || 0;
  const savedLabel = recipe.saved ? 'Saved' : 'Save recipe';
  const savedClass = recipe.saved ? 'is-saved' : '';

  return `
    <article class="assistant-message-row assistant-message-row-bot" data-message-id="${esc(message.id)}">
      <div class="assistant-avatar" aria-hidden="true">F</div>
      <div class="assistant-recipe-card">
        <header class="assistant-recipe-header">
          <div>
            <span class="assistant-recipe-eyebrow">FreshTrack recipe</span>
            <h3>${esc(recipe.title || 'Generated Recipe')}</h3>
          </div>
          <span class="assistant-recipe-spark" aria-hidden="true">✦</span>
        </header>
        <div class="assistant-recipe-meta">
          ${usesCount ? `<span>Uses ${usesCount} pantry item${usesCount === 1 ? '' : 's'}</span>` : ''}
          <span>Prioritises fresh food</span>
        </div>
        ${recipe.summary ? `<p class="assistant-recipe-summary">${esc(recipe.summary)}</p>` : ''}
        ${hasStructuredSections ? `
          <div class="assistant-recipe-grid">
            ${recipe.ingredients?.length ? `
              <section>
                <h4>Ingredients</h4>
                <ul>${recipe.ingredients.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
              </section>` : ''}
            ${recipe.steps?.length ? `
              <section>
                <h4>Steps</h4>
                <ol>${recipe.steps.map((item) => `<li>${esc(item)}</li>`).join('')}</ol>
              </section>` : ''}
          </div>` : `<div class="assistant-rich-text">${richTextHtml(message.text)}</div>`}
        ${recipe.notes?.length ? `<div class="assistant-recipe-note"><strong>Notes</strong>${recipe.notes.map((note) => `<p>${esc(note)}</p>`).join('')}</div>` : ''}
        <div class="assistant-recipe-actions">
          ${messageActionButton('save-recipe', recipe.saved ? '✓' : '♡', savedLabel, savedClass)}
          ${messageActionButton('listen', '◉', 'Listen')}
          ${messageActionButton('copy', '▣', 'Copy')}
          ${messageActionButton('regenerate', '↻', 'Regenerate')}
        </div>
      </div>
    </article>`;
}

function messageHtml(message) {
  if (message.kind === 'recipe' && message.role === 'bot') return recipeCardHtml(message);

  const isUser = message.role === 'user';
  return `
    <article class="assistant-message-row assistant-message-row-${message.role}" data-message-id="${esc(message.id)}">
      ${isUser ? '' : '<div class="assistant-avatar" aria-hidden="true">F</div>'}
      <div class="assistant-message-stack">
        <div class="assistant-message assistant-message-${message.role}">
          ${isUser ? `<p>${esc(message.text)}</p>` : `<div class="assistant-rich-text">${richTextHtml(message.text)}</div>`}
        </div>
        ${isUser ? '' : `
          <div class="assistant-message-actions" aria-label="Response actions">
            ${messageActionButton('listen', '◉', 'Listen')}
            ${messageActionButton('copy', '▣', 'Copy')}
            ${messageActionButton('regenerate', '↻', 'Regenerate')}
          </div>`}
      </div>
    </article>`;
}

function emptyStateHtml() {
  return `
    <div class="assistant-empty-state">
      <div class="assistant-empty-icon" aria-hidden="true">✦</div>
      <h3>What can FreshTrack help with?</h3>
      <p>Ask for a meal, use food nearing expiry, or adapt a recipe to your nutrition goals.</p>
      <div class="assistant-empty-points">
        <span>Use your pantry</span>
        <span>Reduce food waste</span>
        <span>Plan healthier meals</span>
      </div>
    </div>`;
}

function typingHtml() {
  return `
    <article class="assistant-message-row assistant-message-row-bot assistant-typing-row" aria-label="FreshTrack is preparing a response">
      <div class="assistant-avatar" aria-hidden="true">F</div>
      <div class="assistant-message assistant-message-bot assistant-typing">
        <span></span><span></span><span></span>
      </div>
    </article>`;
}

function renderMessages(messagesEl) {
  messagesEl.classList.toggle('is-empty', chatMessages.length === 0 && !pending);
  messagesEl.innerHTML = chatMessages.length
    ? chatMessages.map(messageHtml).join('')
    : emptyStateHtml();
  if (pending) messagesEl.insertAdjacentHTML('beforeend', typingHtml());
  requestAnimationFrame(() => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

function addMessage(messagesEl, message) {
  const normalized = normalizeStoredMessage({
    id: nextMessageId(),
    createdAt: new Date().toISOString(),
    ...message,
  });
  if (!normalized) return null;
  chatMessages.push(normalized);
  chatMessages = chatMessages.slice(-MAX_STORED_MESSAGES);
  persistChatState();
  renderMessages(messagesEl);
  return normalized;
}

function inventoryView(items) {
  const active = Array.isArray(items) ? items : [];
  const expiring = active.filter((item) => {
    const days = item?.expiresAt ? daysUntil(item.expiresAt) : null;
    return days !== null && days >= 0 && days <= 3;
  });
  const featured = [...active]
    .sort((a, b) => {
      const aTime = a?.expiresAt ? new Date(a.expiresAt).getTime() : Infinity;
      const bTime = b?.expiresAt ? new Date(b.expiresAt).getTime() : Infinity;
      return aTime - bTime;
    })
    .slice(0, 4);

  if (!active.length) {
    return `
      <div class="assistant-inventory-empty">
        <div><strong>Your inventory is empty</strong><span>Add food so FreshTrack can tailor its answers.</span></div>
        <a href="#inventory" class="assistant-inline-link">Open inventory</a>
      </div>`;
  }

  return `
    <div class="assistant-inventory-stats">
      <div><strong>${active.length}</strong><span>items available</span></div>
      <div class="${expiring.length ? 'has-warning' : ''}"><strong>${expiring.length}</strong><span>expiring soon</span></div>
    </div>
    <div class="assistant-inventory-items" aria-label="Inventory highlights">
      ${featured.map((item) => {
        const days = item?.expiresAt ? daysUntil(item.expiresAt) : null;
        const suffix = days === null ? '' : days === 0 ? ' · today' : days === 1 ? ' · 1 day' : ` · ${days} days`;
        return `<span>${esc(item.name)}${esc(suffix)}</span>`;
      }).join('')}
    </div>`;
}

function autoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight, 132)}px`;
}

export async function renderAssistant(view) {
  chatMessages = loadChatState();
  inventoryCache = [];
  pending = false;
  lastQuestion = '';

  view.innerHTML = `
    <div class="assistant-workspace">
      <section class="assistant-hero">
        <div class="assistant-hero-main">
          <div class="assistant-orb" aria-hidden="true"><span></span><span></span><span></span></div>
          <div>
            <p class="assistant-kicker">Food intelligence</p>
            <h2>Ask FreshTrack</h2>
            <p>Turn the food you already own into practical meals with less waste.</p>
          </div>
        </div>
        <div class="assistant-hero-side">
          <button type="button" id="assistant-connection" class="assistant-connection-chip is-loading">
            <span class="assistant-connection-dot" aria-hidden="true"></span>
            <span><strong>Checking connection</strong><small>Please wait</small></span>
          </button>
          <div class="assistant-history-actions">
            <button type="button" id="assistant-new-chat" class="assistant-quiet-button">＋ New chat</button>
            <button type="button" id="assistant-clear-history" class="assistant-icon-button" aria-label="Clear chat history" title="Clear chat history">⌫</button>
          </div>
        </div>
      </section>

      <section id="assistant-inventory" class="assistant-inventory-summary" aria-live="polite">
        <div class="assistant-inventory-loading"><span></span><span></span><span></span></div>
      </section>

      <section class="assistant-starters" aria-label="Suggested questions">
        <div class="assistant-section-heading">
          <div><span>Quick starts</span><h3>What should we make?</h3></div>
          <button type="button" class="assistant-generate-button" id="btn-generate-recipe"><span aria-hidden="true">✦</span> Generate a recipe</button>
        </div>
        <div class="assistant-prompt-chips">
          ${QUICK_PROMPTS.map((item) => `
            <button type="button" class="assistant-prompt-chip" data-prompt="${esc(item.prompt)}">
              <span aria-hidden="true">${item.icon}</span>${esc(item.label)}
            </button>`).join('')}
        </div>
      </section>

      <section class="card assistant-chat" aria-label="Food assistant conversation">
        <header class="assistant-chat-header">
          <div>
            <span>Conversation</span>
            <h3>Your pantry assistant</h3>
          </div>
          <p id="assistant-status" class="assistant-status" aria-live="polite">Ready when you are.</p>
        </header>
        <div id="assistant-messages" class="assistant-messages"></div>
        <div class="assistant-composer-wrap">
          <div class="assistant-composer">
            <textarea id="assistant-input" rows="1" maxlength="1200" placeholder="Ask about your inventory, meals, expiry, or nutrition…" aria-label="Message FreshTrack"></textarea>
            <div class="assistant-composer-actions">
              <button type="button" class="assistant-composer-button assistant-mic-button" id="assistant-mic" aria-label="Start voice input" title="Speak">
                <span class="assistant-mic-icon" aria-hidden="true">◉</span>
                <span class="assistant-wave" aria-hidden="true"><i></i><i></i><i></i></span>
              </button>
              <button type="button" class="assistant-composer-button assistant-send-button" id="assistant-send" aria-label="Send message" title="Send" disabled>➤</button>
            </div>
          </div>
          <div class="assistant-composer-hint"><span>Enter to send · Shift + Enter for a new line</span><span id="assistant-character-count">0 / 1200</span></div>
        </div>
      </section>
    </div>`;

  const input = view.querySelector('#assistant-input');
  const messages = view.querySelector('#assistant-messages');
  const status = view.querySelector('#assistant-status');
  const connection = view.querySelector('#assistant-connection');
  const inventory = view.querySelector('#assistant-inventory');
  const mic = view.querySelector('#assistant-mic');
  const send = view.querySelector('#assistant-send');
  const generateBtn = view.querySelector('#btn-generate-recipe');
  const newChatBtn = view.querySelector('#assistant-new-chat');
  const clearHistoryBtn = view.querySelector('#assistant-clear-history');
  const characterCount = view.querySelector('#assistant-character-count');
  const promptButtons = [...view.querySelectorAll('.assistant-prompt-chip')];

  renderMessages(messages);
  if (chatMessages.length) status.textContent = 'Previous conversation restored.';

  const setStatus = (text) => {
    status.textContent = text;
  };

  const updateSendState = () => {
    send.disabled = pending || !input.value.trim();
    characterCount.textContent = `${input.value.length} / 1200`;
  };

  const setPending = (value) => {
    pending = value;
    mic.disabled = value;
    generateBtn.disabled = value;
    promptButtons.forEach((button) => { button.disabled = value; });
    updateSendState();
    renderMessages(messages);
  };

  async function refreshInventory(force = false) {
    if (inventoryCache.length && !force) return inventoryCache;
    const result = await api.getItems('active', { silent: true });
    inventoryCache = Array.isArray(result.items) ? result.items : [];
    inventory.innerHTML = inventoryView(inventoryCache);
    return inventoryCache;
  }

  const [inventoryResult, connectionResult] = await Promise.allSettled([
    refreshInventory(true),
    api.getAiKeyStatus({ silent: true }),
  ]);

  if (inventoryResult.status === 'rejected') {
    inventory.innerHTML = '<div class="assistant-inventory-empty"><div><strong>Inventory unavailable</strong><span>FreshTrack could not load your items.</span></div><button type="button" class="assistant-inline-link" id="assistant-retry-inventory">Retry</button></div>';
    inventory.querySelector('#assistant-retry-inventory')?.addEventListener('click', async () => {
      inventory.innerHTML = '<div class="assistant-inventory-loading"><span></span><span></span><span></span></div>';
      try {
        await refreshInventory(true);
      } catch {
        inventory.innerHTML = '<div class="assistant-inventory-empty"><div><strong>Inventory unavailable</strong><span>Try again shortly.</span></div></div>';
      }
    });
  }

  if (connectionResult.status === 'fulfilled') {
    const meta = connectionMeta(connectionResult.value);
    connection.classList.remove('is-loading');
    connection.classList.toggle('is-connected', meta.connected);
    connection.innerHTML = `<span class="assistant-connection-dot" aria-hidden="true"></span><span><strong>${esc(meta.label)}</strong><small>${esc(meta.detail)}</small></span>`;
    connection.disabled = meta.connected;
  } else {
    connection.classList.remove('is-loading');
    connection.innerHTML = '<span class="assistant-connection-dot" aria-hidden="true"></span><span><strong>Status unavailable</strong><small>Open Settings to check</small></span>';
  }

  connection.addEventListener('click', () => {
    if (!connection.disabled) location.hash = '#settings';
  });

  async function submit(question, { recordUser = true } = {}) {
    const cleanQuestion = String(question || input.value).trim();
    if (!cleanQuestion || pending) return;

    if (recordUser) addMessage(messages, { role: 'user', text: cleanQuestion });
    lastQuestion = cleanQuestion;
    input.value = '';
    autoResize(input);
    updateSendState();
    setStatus('Checking your inventory and preparing a recommendation…');
    setPending(true);

    try {
      const items = await refreshInventory(true);
      const result = await api.askAssistant({ question: cleanQuestion, items });
      const answer = result.answer || 'I could not prepare a recommendation.';
      setPending(false);
      addMessage(messages, {
        role: 'bot',
        kind: 'text',
        text: answer,
        prompt: cleanQuestion,
        provider: result.provider || null,
      });

      if (result.ai) {
        setStatus(`${providerName(result.provider)} response ready.`);
      } else if (result.warning) {
        setStatus(`${result.warning} Built-in recommendation used instead.`);
      } else {
        setStatus('Built-in recommendation ready.');
      }
    } catch {
      setPending(false);
      addMessage(messages, {
        role: 'bot',
        text: 'I could not reach the food assistant. Your inventory is unchanged, so you can safely try again.',
        prompt: cleanQuestion,
      });
      setStatus('Could not reach the food assistant.');
    }
  }

  async function generateRecipe({ recordUser = true } = {}) {
    if (pending) return;
    if (recordUser) {
      addMessage(messages, {
        role: 'user',
        text: 'Generate a recipe using my available ingredients.',
      });
    }

    setStatus('Reviewing your inventory and building a recipe…');
    setPending(true);

    try {
      const items = await refreshInventory(true);
      if (!items.length) {
        setPending(false);
        addMessage(messages, {
          role: 'bot',
          text: 'Your inventory is empty. Add a few food items first, then I can build a recipe around them.',
        });
        setStatus('Add inventory items to generate a recipe.');
        return;
      }

      const usable = items
        .filter((item) => {
          if (!item.expiresAt) return true;
          const remaining = daysUntil(item.expiresAt);
          return remaining !== null && remaining >= 0;
        })
        .sort((a, b) => {
          const aTime = a.expiresAt ? new Date(a.expiresAt).getTime() : Infinity;
          const bTime = b.expiresAt ? new Date(b.expiresAt).getTime() : Infinity;
          return aTime - bTime;
        });

      if (!usable.length) {
        setPending(false);
        addMessage(messages, {
          role: 'bot',
          text: 'All dated items in your inventory are already expired. Review them before cooking and add a fresh item to generate a recipe.',
        });
        setStatus('No unexpired ingredients available.');
        return;
      }

      const itemList = usable.map((item) => {
        const remaining = item.expiresAt ? daysUntil(item.expiresAt) : null;
        const expiry = remaining === null ? '' : remaining === 0 ? ' (expires today)' : ` (expires in ${remaining} day${remaining === 1 ? '' : 's'})`;
        return `${item.name}${expiry}`;
      });
      const goals = loadNutritionGoals();
      const goalPrompt = goals.length
        ? `Nutrition goals: ${goals.join(', ')}. Tailor the recipe toward these goals where possible. `
        : '';
      const prompt = `Create one complete recipe using only the ingredients listed below. Do not add ingredients that are not listed. Prioritize ingredients closest to expiry and do not use expired food. ${goalPrompt}Return a clear recipe title, an Ingredients section with quantities, a numbered Steps section, and a brief food-safety note. Available ingredients: ${itemList.join(', ')}`;
      lastQuestion = prompt;

      const result = await api.askAssistant({ question: prompt, items: usable, goals });
      const answer = result.answer || 'I could not prepare a recipe. Please try again.';
      const recipe = {
        ...parseRecipe(answer, usable.map((item) => item.name)),
        ai: Boolean(result.ai),
        provider: result.provider || null,
      };

      try {
        localStorage.setItem(RECIPE_STORAGE_KEY, JSON.stringify(recipe));
      } catch {
        // The recipe still remains in the current conversation.
      }

      setPending(false);
      addMessage(messages, {
        role: 'bot',
        kind: 'recipe',
        text: answer,
        prompt,
        provider: result.provider || null,
        recipe,
      });

      if (result.ai) {
        setStatus(`${providerName(result.provider)} recipe ready.`);
      } else if (result.warning) {
        setStatus(`${result.warning} Built-in recipe used instead.`);
      } else {
        setStatus('Built-in recipe ready.');
      }
    } catch {
      setPending(false);
      addMessage(messages, {
        role: 'bot',
        text: 'I could not generate the recipe this time. Please try again in a moment.',
      });
      setStatus('Could not generate a recipe.');
    }
  }

  function clearConversation({ clearRecipe = false } = {}) {
    chatMessages = [];
    localStorage.removeItem(CHAT_STORAGE_KEY);
    if (clearRecipe) localStorage.removeItem(RECIPE_STORAGE_KEY);
    renderMessages(messages);
    setStatus(clearRecipe ? 'Chat and saved local recipe cleared.' : 'New conversation started.');
  }

  promptButtons.forEach((button) => {
    button.addEventListener('click', () => submit(button.dataset.prompt));
  });
  generateBtn.addEventListener('click', () => generateRecipe());
  send.addEventListener('click', () => submit());

  input.addEventListener('input', () => {
    autoResize(input);
    updateSendState();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });

  newChatBtn.addEventListener('click', () => {
    if (chatMessages.length && !window.confirm('Start a new chat? The current conversation will be removed from this browser.')) return;
    clearConversation();
    input.focus();
  });
  clearHistoryBtn.addEventListener('click', () => {
    if (!window.confirm('Clear the chat history and the locally saved generated recipe from this browser?')) return;
    clearConversation({ clearRecipe: true });
  });

  messages.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-message-action]');
    if (!button || pending) return;
    const row = button.closest('[data-message-id]');
    const message = chatMessages.find((item) => item.id === row?.dataset.messageId);
    if (!message) return;

    const action = button.dataset.messageAction;
    if (action === 'listen') {
      speak(message.text);
      setStatus('Reading the response aloud.');
      return;
    }
    if (action === 'copy') {
      await copyText(message.text);
      return;
    }
    if (action === 'regenerate') {
      if (message.kind === 'recipe') await generateRecipe({ recordUser: false });
      else await submit(message.prompt || lastQuestion, { recordUser: false });
      return;
    }
    if (action === 'save-recipe' && message.recipe) {
      if (message.recipe.saved) {
        toast('This recipe is already saved.', 'success');
        return;
      }
      message.recipe.saved = true;
      message.recipe.timestamp = message.recipe.timestamp || new Date().toISOString();
      addRecipeAlert(message.recipe);
      refreshAlertBadge();
      persistChatState();
      try {
        localStorage.setItem(RECIPE_STORAGE_KEY, JSON.stringify(message.recipe));
      } catch {
        // Alert storage is handled by addRecipeAlert.
      }
      renderMessages(messages);
      setStatus('Recipe saved to Alerts.');
      toast('Recipe saved to Alerts.', 'success');
    }
  });

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    mic.disabled = true;
    mic.title = 'Voice input unavailable';
    mic.setAttribute('aria-label', 'Voice input unavailable');
  } else {
    recognition = new SpeechRecognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      listening = true;
      mic.classList.add('is-listening');
      mic.setAttribute('aria-label', 'Stop voice input');
      setStatus('Listening…');
    };
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      input.value = transcript;
      autoResize(input);
      updateSendState();
      submit(transcript);
    };
    recognition.onerror = () => {
      setStatus('Voice input stopped. Try again or type your question.');
    };
    recognition.onend = () => {
      listening = false;
      mic.classList.remove('is-listening');
      mic.setAttribute('aria-label', 'Start voice input');
    };
    mic.addEventListener('click', () => {
      if (listening) recognition.stop();
      else recognition.start();
    });
  }

  updateSendState();
  autoResize(input);
}
