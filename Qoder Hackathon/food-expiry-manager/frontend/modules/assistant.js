import { api } from './api.js';
import { toast } from '../app.js';
import { esc } from './util.js';

const PRESETS = [
  'What should I cook today using food that expires soon?',
  'Suggest a healthy meal using what I already have.',
  'Which food should I eat first to reduce waste?',
];

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
    send.disabled = true;
    mic.disabled = true;
    status.textContent = 'Checking your inventory and preparing a recommendation…';
    try {
      const inventory = await api.getItems('active', { silent: true });
      const result = await api.askAssistant({ question, items: inventory.items || [] });
      const answer = result.answer || 'I could not prepare a recommendation.';
      messages.insertAdjacentHTML('beforeend', `<div class="assistant-message assistant-message-bot">${esc(answer)}</div>`);
      messages.scrollTop = messages.scrollHeight;
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
    }
  }

  view.querySelectorAll('.assistant-preset').forEach((button) => {
    button.addEventListener('click', () => submit(button.dataset.prompt));
  });
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
