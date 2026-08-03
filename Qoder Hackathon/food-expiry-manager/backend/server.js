/**
 * server.js — Food Expiry Manager API + static frontend host.
 */
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const multer = require('multer');

const { init } = require('./db/init');
const seed = require('./db/seed');
const db = require('./db/db');
const inventory = require('./services/inventory');
const shelfLife = require('./services/shelfLife');
const recommendations = require('./services/recommendations');
const insights = require('./services/insights');
const reliability = require('./services/reliability');
const llmClient = require('./services/llmClient');

const PORT = process.env.PORT || 3000;
const SOON_DAYS = 3;

// ---------- bootstrap ----------
try {
  init();
  const seeded = seed.seedIfEmpty();
  if (seeded) console.log(`Seeded ${seeded} demo items`);
} catch (err) {
  console.error('Database initialization failed. Try deleting backend/db/food.db and restarting.');
  console.error(err);
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

// static frontend + uploaded photos
app.use(express.static(path.join(__dirname, '..', 'frontend')));
const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
      const safeExt = path.extname(file.originalname).replace(/[^.\w]/g, '').slice(0, 10);
      cb(null, `photo-${Date.now()}-${Math.round(Math.random() * 1e6)}${safeExt}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new HttpError(400, 'Only image uploads are allowed'));
  },
});

// small helpers
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const toNumber = (v) => (v === undefined || v === null || v === '' ? undefined : Number(v));

// numeric field validation — absent/null/'' stay undefined, anything else must be valid
const validQuantity = (v) => {
  const n = toNumber(v);
  if (n !== undefined && (!Number.isFinite(n) || n < 0)) {
    throw new HttpError(400, 'quantity must be a finite number >= 0');
  }
  return n;
};
const validConfidence = (v) => {
  const n = toNumber(v);
  if (n !== undefined && (!Number.isFinite(n) || n < 0 || n > 1)) {
    throw new HttpError(400, 'confidence must be a finite number between 0 and 1');
  }
  return n;
};

/** Whole days from today until the given ISO date (negative = past), matching frontend util.js. */
function daysUntil(iso) {
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((startOfTarget - startOfToday) / 86400000);
}

// ---------- items ----------
app.get('/api/items', wrap((req, res) => {
  const status = req.query.status === 'all' ? 'all' : (req.query.status || 'active');
  res.json({ items: inventory.list(status) });
}));

app.post('/api/items', upload.single('photo'), wrap((req, res) => {
  const body = req.body || {};
  const name = (body.name || '').trim();
  if (!name) throw new HttpError(400, 'name is required');

  const source = body.source || 'manual';
  if (!['cv', 'manual', 'demo'].includes(source)) throw new HttpError(400, "source must be 'cv', 'manual' or 'demo'");

  // fill category / expiresAt / nutrition from reference data when absent
  const match = shelfLife.findMatch(name);
  const category = body.category || (match ? match.entry.category : 'other');
  const expiresAt = body.expiresAt || shelfLife.estimateExpiry(name).expiresAt;

  let nutrition = body.nutrition;
  if (typeof nutrition === 'string') {
    try { nutrition = JSON.parse(nutrition); } catch { nutrition = undefined; }
  }
  if (nutrition === undefined || nutrition === null) {
    nutrition = shelfLife.getNutrition(name);
  }

  const item = inventory.create({
    name,
    category,
    quantity: validQuantity(body.quantity) ?? null,
    unit: body.unit ?? null,
    expiresAt,
    source,
    confidence: validConfidence(body.confidence) ?? null,
    photoPath: req.file ? `uploads/${req.file.filename}` : null,
    nutrition,
  });

  const flags = reliability.validateOnCreate(item);
  res.status(201).json({ item, flags });
}));

app.put('/api/items/:id', wrap((req, res) => {
  const body = req.body || {};
  if (body.status !== undefined && !['active', 'consumed', 'discarded'].includes(body.status)) {
    throw new HttpError(400, "status must be 'active', 'consumed' or 'discarded'");
  }
  if (body.quantity !== undefined) body.quantity = validQuantity(body.quantity) ?? null;
  if (body.confidence !== undefined) body.confidence = validConfidence(body.confidence) ?? null;
  const item = inventory.update(Number(req.params.id), body);
  if (!item) throw new HttpError(404, 'item not found');
  res.json({ item });
}));

app.delete('/api/items/:id', wrap((req, res) => {
  const ok = inventory.remove(Number(req.params.id));
  if (!ok) throw new HttpError(404, 'item not found');
  res.status(204).end();
}));

app.post('/api/items/:id/consume', wrap((req, res) => {
  const item = inventory.logAction(Number(req.params.id), 'consumed');
  if (!item) throw new HttpError(404, 'item not found');
  res.json({ item });
}));

app.post('/api/items/:id/discard', wrap((req, res) => {
  const item = inventory.logAction(Number(req.params.id), 'discarded');
  if (!item) throw new HttpError(404, 'item not found');
  res.json({ item });
}));

// ---------- alerts ----------
app.get('/api/alerts', wrap((req, res) => {
  const active = inventory.list('active');
  const expired = [];
  const expiringSoon = [];
  for (const item of active) {
    if (!item.expiresAt) continue;
    const days = daysUntil(item.expiresAt);
    if (days === null) continue;
    if (days < 0) expired.push(item);
    else if (days <= SOON_DAYS) expiringSoon.push(item);
  }
  res.json({ expired, expiringSoon });
}));

// ---------- recommendations / insights ----------
app.get('/api/recommendations', wrap(async (req, res) => {
  res.json(await recommendations.getRecommendations());
}));

app.get('/api/insights', wrap((req, res) => {
  res.json(insights.getInsights());
}));

// ---------- reliability bot ----------
app.get('/api/reliability/flags', wrap((req, res) => {
  const includeResolved = req.query.all === '1' || req.query.all === 'true';
  res.json({ flags: reliability.listFlags(includeResolved) });
}));

app.post('/api/reliability/scan', wrap((req, res) => {
  const flags = reliability.scan();
  res.json({ created: flags.length, flags });
}));

app.post('/api/reliability/flags/:id/resolve', wrap((req, res) => {
  const flag = reliability.resolveFlag(Number(req.params.id));
  if (!flag) throw new HttpError(404, 'flag not found');
  res.json({ flag });
}));

// ---------- health / demo ----------
app.get('/api/health', wrap((req, res) => {
  db.get('SELECT 1 AS ok'); // throws if the DB is broken
  const demo = db.get("SELECT COUNT(*) AS n FROM items WHERE source = 'demo'").n > 0;
  res.json({ db: 'ok', mode: demo ? 'demo' : 'live', llm: llmClient.isEnabled() });
}));

app.post('/api/demo/reseed', wrap((req, res) => {
  res.json({ seeded: seed.reseed() });
}));

// ---------- assistant ----------
app.post('/api/assistant', wrap(async (req, res) => {
  const body = req.body || {};
  const question = String(body.question || '').trim().slice(0, 600);
  if (!question) throw new HttpError(400, 'question is required');

  // Use the live inventory: exclude expired items, prioritize soonest expiry.
  const usable = inventory.list('active')
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

  // LLM path (OpenAI/Gemini when a key is configured).
  const llm = await llmClient.askAssistant(question, usable);
  if (llm) {
    return res.json({ answer: llm.answer, ai: true, provider: llm.provider, keySource: 'server' });
  }

  // No key (or LLM failure) → deterministic rule-based fallback, never an error.
  return res.json({
    answer: llmClient.fallbackAnswer(question, usable),
    ai: false,
    provider: null,
    keySource: 'none',
    ...(llmClient.isEnabled() ? { warning: 'The AI service did not respond. Built-in recipe used instead.' } : {}),
  });
}));

// ---------- errors ----------
app.use('/api', (req, res, next) => next(new HttpError(404, 'not found')));

// central error handler → { error: message } with proper status codes
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err instanceof multer.MulterError ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'internal server error' });
});

// ---------- start ----------
app.listen(PORT, () => {
  console.log(`Food Expiry Manager backend listening on http://localhost:${PORT}`);
  // reliability bot: scan now and every 6 hours
  try {
    const created = reliability.scan();
    if (created.length) console.log(`Reliability scan created ${created.length} flag(s)`);
  } catch (err) {
    console.error('Reliability scan failed:', err);
  }
});
setInterval(() => {
  try {
    reliability.scan();
  } catch (err) {
    console.error('Reliability scan failed:', err);
  }
}, 6 * 60 * 60 * 1000);
