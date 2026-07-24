// Scan tab: photo capture / demo picker → downscale → classify → editable result card.

import { api } from './api.js';
import { classifyImage, warmupClassifier } from './classifier.js';
import { toast } from '../app.js';
import { esc, categoryOptions, toDateInputValue } from './util.js';

const DEMO_IMAGES = [
  { file: 'demo-images/banana.png', label: 'Banana' },
  { file: 'demo-images/apple.png', label: 'Apple' },
  { file: 'demo-images/bread.png', label: 'Bread' },
  { file: 'demo-images/tomato.png', label: 'Tomato' },
];

const MAX_DIM = 512;

/** Downscale an image blob so its longest side is ≤ MAX_DIM px. */
async function downscale(blob) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}

function isoInDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export async function renderScan(view) {
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

    <h3>Or try a demo image</h3>
    <div class="demo-strip" id="demo-strip">
      ${DEMO_IMAGES.map((d, i) => `
        <button class="demo-thumb" data-idx="${i}" title="${esc(d.label)}">
          <img src="${d.file}" alt="${esc(d.label)}" loading="lazy">
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

  view.querySelector('#scan-input').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handleImage(file, stage);
    e.target.value = '';
  });

  view.querySelector('#demo-strip').addEventListener('click', async (e) => {
    const btn = e.target.closest('.demo-thumb');
    if (!btn) return;
    const demo = DEMO_IMAGES[Number(btn.dataset.idx)];
    try {
      const res = await fetch(demo.file);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      handleImage(await res.blob(), stage);
    } catch {
      toast('Could not load demo image.', 'error');
    }
  });

  view.querySelector('#manual-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
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

async function handleImage(blob, stage) {
  const previewUrl = URL.createObjectURL(blob);
  stage.innerHTML = `
    <div class="card">
      <img class="scan-preview" src="${previewUrl}" alt="Selected food photo">
      <div class="progress-wrap" id="scan-progress">
        <span class="spinner"></span> Identifying food…
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

  const progressEl = stage.querySelector('#scan-progress');
  const fillEl = stage.querySelector('#scan-progress-fill');
  const result = await classifyImage(small, (p) => {
    if (p.stage === 'download' && fillEl) {
      progressEl.firstChild.textContent = '';
      progressEl.childNodes[1].textContent = ` Downloading model… ${p.pct}%`;
      fillEl.style.width = `${p.pct}%`;
    } else if (p.stage === 'fallback' && progressEl) {
      progressEl.childNodes[1].textContent = ' Using quick estimate…';
    }
  });

  renderResultCard(stage, previewUrl, result);
}

function renderResultCard(stage, previewUrl, result) {
  const shelfDays = result.shelfDays ?? 7;
  const defaultExpiry = toDateInputValue(isoInDays(shelfDays));
  const confPct = Math.round(result.confidence * 100);
  const sourceNote = result.source === 'mock'
    ? '<span class="source-note">quick estimate</span>'
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
            <p class="card-sub">Leave blank to auto-estimate</p>
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

  stage.querySelector('#result-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = (sel) => stage.querySelector(sel);
    const expiry = q('#r-expiry').value;
    const payload = {
      name: q('#r-name').value.trim(),
      category: q('#r-category').value,
      quantity: Number(q('#r-qty').value) || 1,
      unit: q('#r-unit').value.trim() || 'pcs',
      source: 'cv',
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
