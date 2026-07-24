const DAY_MS = 86400000;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function cleanItems(items) {
  return (Array.isArray(items) ? items : []).slice(0, 40).map((item) => ({
    name: String(item?.name || '').slice(0, 80),
    category: String(item?.category || 'other').slice(0, 40),
    quantity: item?.quantity ?? null,
    unit: item?.unit ?? null,
    expiresAt: item?.expiresAt || null,
  })).filter((item) => item.name);
}

function daysUntil(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - Date.now()) / DAY_MS);
}

function fallbackAnswer(question, items) {
  if (!items.length) return 'Your inventory is empty. Add or scan some food first, then I can suggest what to cook and what to use soon.';
  const urgent = [...items]
    .map((item) => ({ ...item, days: daysUntil(item.expiresAt) }))
    .filter((item) => item.days !== null)
    .sort((a, b) => a.days - b.days)
    .slice(0, 4);
  const names = urgent.length ? urgent.map((item) => item.name) : items.slice(0, 4).map((item) => item.name);
  const lower = question.toLowerCase();
  if (lower.includes('healthy')) {
    return `For a healthier meal, combine ${names.slice(0, 3).join(', ')} with a simple protein and whole grain. Use minimal oil, add vegetables, and check that every item is still safe before cooking.`;
  }
  if (lower.includes('first') || lower.includes('waste') || lower.includes('expire')) {
    return `Use ${names.join(', ')} first because they are the most time-sensitive items in your inventory. Plan one meal around them today and freeze anything you cannot use safely.`;
  }
  return `A practical option is to build a simple bowl, stir-fry, soup, or sandwich using ${names.join(', ')}. Start with the items expiring soonest, season simply, and confirm freshness before eating.`;
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

module.exports = async function handler(req, res) {
  if ((req.method || 'GET') !== 'POST') return json(res, 405, { error: 'method not allowed' });
  const body = req.body || {};
  const question = String(body.question || '').trim().slice(0, 600);
  const items = cleanItems(body.items);
  if (!question) return json(res, 400, { error: 'question is required' });

  const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
  if (!apiKey) return json(res, 200, { answer: fallbackAnswer(question, items), ai: false });

  try {
    const inventoryText = items.length
      ? items.map((item) => `${item.name}${item.quantity != null ? ` (${item.quantity} ${item.unit || ''})` : ''}${item.expiresAt ? `, expires ${item.expiresAt.slice(0, 10)}` : ''}`).join('; ')
      : 'No inventory items available.';
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5-mini',
        store: false,
        max_output_tokens: 220,
        instructions: 'You are FreshTrack, a concise food inventory assistant. Give practical meal and food-waste recommendations based only on the supplied inventory. Mention food-safety uncertainty and never claim an item is safe solely from its date. Keep the answer under 90 words and suitable for spoken playback.',
        input: `Inventory: ${inventoryText}\n\nUser question: ${question}`,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || `OpenAI request failed (${response.status})`);
    const answer = extractText(data);
    if (!answer) throw new Error('Empty model response');
    return json(res, 200, { answer, ai: true });
  } catch (error) {
    console.error('Assistant AI failed:', error);
    return json(res, 200, { answer: fallbackAnswer(question, items), ai: false });
  }
};
