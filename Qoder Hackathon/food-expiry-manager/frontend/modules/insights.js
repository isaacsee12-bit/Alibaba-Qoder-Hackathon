// Insights tab: category balance bars, waste rate, eat more/less advice, nutrition summary.

import { api } from './api.js';
import { esc } from './util.js';

export async function renderInsights(view) {
  view.innerHTML = `
    <h2>Insights</h2>
    <div id="insights-body"><div class="empty-state"><span class="spinner"></span></div></div>
  `;
  const body = view.querySelector('#insights-body');

  let data;
  try {
    data = await api.getInsights({ silent: true });
  } catch {
    body.innerHTML = `<div class="empty-state"><span class="emoji">📊</span>Couldn't load insights.<br>Check that the server is running.</div>`;
    return;
  }

  const balance = data.categoryBalance || [];
  const eatMore = data.eatMore || [];
  const eatLess = data.eatLess || [];
  const wasteRate = data.wasteRate;

  body.innerHTML = `
    <div class="stat-grid">
      <div class="card stat-card">
        <div class="stat-value ${wasteRate != null && wasteRate > 0.2 ? 'bad' : ''}">${wasteRate != null ? `${Math.round(wasteRate * 100)}%` : '—'}</div>
        <div class="stat-label">Waste rate</div>
      </div>
      <div class="card stat-card">
        <div class="stat-value">${balance.reduce((n, c) => n + (c.count || 0), 0)}</div>
        <div class="stat-label">Items tracked</div>
      </div>
    </div>

    <h3>Category balance</h3>
    <div class="card">
      ${balance.length === 0 ? `<p class="muted">No items yet — add food to see your balance.</p>` : ''}
      ${balance.map((c) => barRow(c)).join('')}
      ${balance.length ? `<p class="muted" style="margin-bottom:0">▎marker shows the recommended target share.</p>` : ''}
    </div>

    ${eatMore.length ? `<h3>🥦 Eat more</h3>` : ''}
    ${eatMore.map((a) => adviceCard(a, 'fresh')).join('')}

    ${eatLess.length ? `<h3>🍩 Eat less</h3>` : ''}
    ${eatLess.map((a) => adviceCard(a, 'soon')).join('')}

    ${data.nutritionSummary ? `
      <h3>Nutrition summary</h3>
      <div class="card">${nutritionHtml(data.nutritionSummary)}</div>` : ''}
  `;
}

function barRow(c) {
  const share = Math.max(0, Math.min(1, c.share ?? 0));
  const target = Math.max(0, Math.min(1, c.target ?? 0));
  const over = target > 0 && share > target * 1.25;
  return `
    <div class="bar-row">
      <div class="bar-label">
        <span style="text-transform:capitalize">${esc(c.category)} · ${c.count ?? 0}</span>
        <span class="muted">${Math.round(share * 100)}% / target ${Math.round(target * 100)}%</span>
      </div>
      <div class="bar-track">
        <div class="bar-fill ${over ? 'over' : ''}" style="width:${Math.round(share * 100)}%"></div>
        <div class="bar-target" style="left:${Math.round(target * 100)}%"></div>
      </div>
    </div>
  `;
}

function adviceCard(a, urgency) {
  const title = a.name || a.category || 'Suggestion';
  return `
    <div class="card urgency-${urgency}">
      <p class="card-title" style="text-transform:capitalize">${esc(title)}</p>
      <p class="card-sub">${esc(a.reason || '')}</p>
    </div>
  `;
}

function nutritionHtml(summary) {
  if (typeof summary === 'string') return `<p class="card-sub" style="margin:0">${esc(summary)}</p>`;
  if (typeof summary === 'object' && summary !== null) {
    return Object.entries(summary)
      .map(([k, v]) => `<p class="card-sub" style="margin:2px 0"><strong style="text-transform:capitalize">${esc(k)}:</strong> ${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</p>`)
      .join('');
  }
  return '';
}
