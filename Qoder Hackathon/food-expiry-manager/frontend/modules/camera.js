// Scan tab: photo capture / demo picker → AI vision or local classifier → editable result card.

import { api } from './api.js';
import { classifyImage, warmupClassifier } from './classifier.js';
import { toast } from '../app.js';
import { esc, categoryOptions, toDateInputValue } from './util.js';

const DEMO_IMAGES = [
  { file: 'demo-images/banana.png', label: 'Banana', name: 'banana', category: 'fruit', shelfDays: 5 },
  { file: 'demo-images/apple.png', label: 'Apple', name: 'apple', category: 'fruit', shelfDays: 14 },
  { file: 'demo-images/bread.png', label: 'Bread', name: 'bread', category: 'grain', shelfDays: 4 },
  { file: 'demo-images/tomato.png', label: 'Tomato', name: 'tomato', category: 'vegetable', shelfDays: 6 },
  { file: 'demo-images/strawberry.svg', label: 'Strawberries', name: 'strawberry', category: 'fruit', shelfDays: 5 },
  { file: 'demo-images/broccoli.svg', label: 'Broccoli', name: 'broccoli', category: 'vegetable', shelfDays: 7 },
  { file: 'demo-images/avocado.svg', label: 'Avocado', name: 'avocado', category: 'fruit', shelfDays: 4 },
  { file: 'demo-images/yogurt.svg', label: 'Yogurt', name: 'yogurt', category: 'dairy', shelfDays: 10 },
];

const MAX_DIM = 512;

function canvasToJpeg(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas conversion failed'));
    }, 'image/jpeg', 0.85);
  });
}

async function decodeWithImageElement(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function downscale(blob) {
  let source;
  let width;
  let height;
  let closeSource = () => {};

  try {
    source = await createImageBitmap(blob);
    width = source.width;
    height = source.height;
    closeSource = () => source.close();
  } catch {
    source = await decodeWithImageElement(blob);
    width = source.naturalWidth;
    height = source.naturalHeight;
  }

  if (!width || !height) {
    closeSource();
    throw new Error('Image has no readable dimensions');
  }

  const scale = Math.min(1, MAX_DIM / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;

  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable');
    context.drawImage(source, 0, 0, w, h);
    return await canvasToJpeg(canvas);
  } finally {
    closeSource();
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not encode image'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function isoInDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function scanModeText(status) {
  if (status?.source === 'user') return `Enhanced AI vision connected · key ending ${status.suffix || '••••'}`;
  if (status?.source === 'server') return 'Enhanced AI vision connected through the server';
  return 'Using the private on-device scanner. Connect an API key in Settings for enhanced AI vision.';
}

export async function renderScan(view) {
  let aiStatus = { connected: false, source: 'none' };
  try {
    aiStatus = await api.getAiKeyStatus({ silent: true });
  } catch { /* local scanning still works */ }

  view.innerHTML = `
    <h2>Scan food</h2>
    <label class="scan-drop">
      <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>
      </svg>
      Take / choose photo
      <small>Snap your groceries and we'll identify them</small>
      <input type="file" accept="image/*" capture="environment" id="scan-input">
    </label>
    <p class="card-sub">${esc(scanModeText(aiStatus))}</p>

    <h3>Or try a demo image</h3>
    <div class="demo-strip" id="demo-strip">
      ${DEMO_IMAGES.map((demo, index) => `
        <button class="demo-thumb" data-idx="${index}" title="${esc(demo.label)}" aria-label="Try ${esc(demo.label)} demo image">
          <img src="${demo.file}" alt="${esc(demo.label)}" loading="lazy">
        </button>`).join('')}
    </div>

    <div id="scan-stage"></div>

    <h3>Enter manually</h3>
    <form class="card" id="manual-form">
      <div class="field">
        <label for="m-name">Name</label>
        <input id="m-name" required placeholder="e.g. Strawberries">
      </div>
      <div class="field-row">
        <div class="field">
          <label for="m-category">Category</label>
          <select id="m-category">${categoryOptions('other')}</select>
        </div>
        <div class="field">
          <label for="m-expiry">Expiry date</label>
          <input id="m-expiry" type="date">
          <p class="card-sub">Leave blank to auto-estimate</p>
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="m-qty">Quantity</label>
          <input id="m-qty" type="number" min="0" step="any" value="1">
        </div>
        <div class="field">
          <label for="m-unit">Unit</label>
          <input id="m-unit" placeholder="pcs" value="pcs">
        </div>
      </div>
      <button class="btn btn-primary btn-block" type="submit">Add to inventory</button>
    </form>
  `;

  warmupClassifier();
  const stage = view.querySelector('#scan-stage');

  view.querySelector('#scan-input').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) handleImage(file, stage, null, aiStatus);
    event.target.value = '';
  });

  view.querySelector('#demo-strip').addEventListener('click', async (event) => {
    const button = event.target.closest('.demo-thumb');
    if (!button) return;
    const demo = DEMO_IMAGES[Number(button.dataset.idx)];
    try {
      const response = await fetch(demo.file);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await handleImage(await response.blob(), stage, demo, aiStatus);
    } catch {
      toast('Could not load demo image.', 'error');
    }
  });

  view.querySelector('#manual-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    const expiry = form.querySelector('#m-expiry').value;
    const payload = {
      name: form.querySelector('#m-name').value.trim(),
      category: form.querySelector('#m-category').value,
      quantity: Number(form.querySelector('#m-qty').value) || 1,
      unit: form.querySelector('#m-unit').value.trim() || 'pcs',
      source: 'manual',
    };
    if (expiry) payload.expiresAt = new Date(`${expiry}T12:00:00`).toISOString();
    try {
      await api.createItem(payload);
      toast(`Added ${payload.name} to inventory`, 'success');
      form.reset();
      form.querySelector('#m-qty').value = '1';
      form.querySelector('#m-unit').value = 'pcs';
    } catch { /* toast raised by api */ }
  });
}

async function localClassification(blob, progressText, progressFill) {
  return classifyImage(blob, (progress) => {
    if (progress.stage === 'download') {
      progressText.textContent = `Downloading on-device model… ${progress.pct}%`;
      progressFill.style.width = `${progress.pct}%`;
    } else if (progress.stage === 'fallback') {
      progressText.textContent = 'Using quick local estimate…';
    }
  });
}

async function handleImage(blob, stage, demo = null, aiStatus = { connected: false }) {
  const previewUrl = URL.createObjectURL(blob);
  stage.innerHTML = `
    <div class="card">
      <img class="scan-preview" src="${previewUrl}" alt="Selected food photo">
      <div class="progress-wrap" id="scan-progress">
        <span class="spinner"></span>
        <span id="scan-progress-text">Identifying food…</span>
        <div class="progress-bar"><div id="scan-progress-fill"></div></div>
      </div>
    </div>
  `;
  stage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  let small;
  try {
    small = await downscale(blob);
  } catch {
    toast('Could not read that image.', 'error');
    stage.innerHTML = '';
    URL.revokeObjectURL(previewUrl);
    return;
  }

  const progressText = stage.querySelector('#scan-progress-text');
  const progressFill = stage.querySelector('#scan-progress-fill');
  let result;

  if (demo) {
    result = {
      name: demo.name,
      category: demo.category,
      shelfDays: demo.shelfDays,
      confidence: 0.99,
      alternatives: [],
      source: 'demo',
    };
  } else if (aiStatus.connected) {
    try {
      progressText.textContent = 'Analyzing with connected AI vision…';
      progressFill.style.width = '55%';
      const aiResult = await api.scanFoodWithAi(await blobToDataUrl(small), { silent: true });
      result = { ...aiResult, source: 'ai' };
      progressFill.style.width = '100%';
    } catch (error) {
      progressText.textContent = 'AI scan unavailable — switching to the on-device scanner…';
      progressFill.style.width = '0%';
      result = await localClassification(small, progressText, progressFill);
      result.aiWarning = error.message;
    }
  } else {
    result = await localClassification(small, progressText, progressFill);
  }

  renderResultCard(stage, previewUrl, result);
}

function renderResultCard(stage, previewUrl, result) {
  const shelfDays = result.shelfDays ?? 7;
  const defaultExpiry = toDateInputValue(isoInDays(shelfDays));
  const confPct = Math.round((result.confidence ?? 0.65) * 100);
  const sourceNote = result.source === 'demo'
    ? '<span class="source-note">curated demo</span>'
    : result.source === 'ai'
      ? '<span class="source-note">connected AI vision</span>'
      : result.source === 'mock'
        ? '<span class="source-note">quick local estimate</span>'
        : `<span class="source-note">on-device AI${result.model ? ` · ${esc(result.model.split('/')[1] || result.model)}` : ''}</span>`;

  stage.innerHTML = `
    <div class="card urgency-fresh">
      <img class="scan-preview" src="${previewUrl}" alt="Selected food photo">
      <div style="margin-top:12px">
        <div class="section-head">
          <p class="card-title" style="text-transform:capitalize">${esc(result.name)}</p>
          ${sourceNote}
        </div>
        <div class="confidence-meter"><div style="width:${confPct}%"></div></div>
        <p class="card-sub">Confidence: ${confPct}%${result.alternatives?.length ? ` · could also be ${esc(result.alternatives.join(', '))}` : ''}</p>
        ${result.aiWarning ? `<p class="warning-note">AI scan could not be used: ${esc(result.aiWarning)} The local scanner produced this result instead.</p>` : ''}
      </div>
      <form id="result-form" style="margin-top:12px">
        <div class="field">
          <label for="r-name">Name</label>
          <input id="r-name" required value="${esc(result.name)}">
        </div>
        <div class="field-row">
          <div class="field">
            <label for="r-category">Category</label>
            <select id="r-category">${categoryOptions(result.category || 'other')}</select>
          </div>
          <div class="field">
            <label for="r-expiry">Expiry date</label>
            <input id="r-expiry" type="date" value="${defaultExpiry}">
            <p class="card-sub">Estimated only. Check the actual food and packaging.</p>
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="r-qty">Quantity</label>
            <input id="r-qty" type="number" min="0" step="any" value="1">
          </div>
          <div class="field">
            <label for="r-unit">Unit</label>
            <input id="r-unit" value="pcs">
          </div>
        </div>
        <button class="btn btn-primary btn-block" type="submit">Add to inventory</button>
      </form>
    </div>
  `;

  stage.querySelector('#result-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = (selector) => stage.querySelector(selector);
    const expiry = query('#r-expiry').value;
    const payload = {
      name: query('#r-name').value.trim(),
      category: query('#r-category').value,
      quantity: Number(query('#r-qty').value) || 1,
      unit: query('#r-unit').value.trim() || 'pcs',
      source: result.source === 'demo' ? 'demo' : 'cv',
      confidence: result.confidence,
    };
    if (expiry) payload.expiresAt = new Date(`${expiry}T12:00:00`).toISOString();
    try {
      await api.createItem(payload);
      toast(`Added ${payload.name} to inventory`, 'success');
      stage.innerHTML = '';
      URL.revokeObjectURL(previewUrl);
    } catch { /* toast raised by api */ }
  });
}
