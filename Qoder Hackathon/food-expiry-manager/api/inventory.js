const { createClient } = require('@libsql/client');
const shelfLife = require('../backend/data/shelf_life.json');
const nutritionData = require('../backend/data/nutrition.json');
const recipes = require('../backend/data/recipes.json');

const DAY_MS = 86400000;
const SOON_DAYS = 3;
let initialized = false;

function client() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error('TURSO_DATABASE_URL is not configured');
  return createClient({ url, authToken });
}

async function init(db) {
  if (initialized) return;
  const statements = [
    `CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT,
      quantity REAL,
      unit TEXT,
      added_at TEXT NOT NULL,
      expires_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      source TEXT NOT NULL DEFAULT 'manual',
      confidence REAL,
      photo_path TEXT,
      nutrition_json TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS reliability_flags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      flag_type TEXT NOT NULL,
      detail TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS consumption_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_items_expires_at ON items(expires_at)',
    'CREATE INDEX IF NOT EXISTS idx_items_category ON items(category)'
  ];
  for (const sql of statements) await db.execute(sql);
  await seedIfEmpty(db);
  initialized = true;
}

function normalize(value = '') {
  return String(value).toLowerCase().trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function levenshtein(a, b) {
  const m = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = m[0];
    m[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = m[j];
      m[j] = Math.min(m[j] + 1, m[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = old;
    }
  }
  return m[b.length];
}

function findFood(name) {
  const n = normalize(name);
  let exact = shelfLife.find((x) => normalize(x.name) === n);
  if (exact) return { entry: exact, matchedName: exact.name, matchType: 'exact' };
  const partial = shelfLife.find((x) => normalize(x.name).includes(n) || n.includes(normalize(x.name)));
  if (partial) return { entry: partial, matchedName: partial.name, matchType: 'substring' };
  let best = null;
  for (const entry of shelfLife) {
    const d = levenshtein(n, normalize(entry.name));
    if (!best || d < best.distance) best = { entry, matchedName: entry.name, matchType: 'levenshtein', distance: d };
  }
  return best && best.distance <= Math.max(2, Math.floor(n.length * 0.3)) ? best : null;
}

function estimateExpiry(name) {
  const match = findFood(name);
  const days = match?.entry?.fridgeDays || 7;
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

function rowToItem(row) {
  if (!row) return null;
  let nutrition = null;
  try { nutrition = row.nutrition_json ? JSON.parse(row.nutrition_json) : null; } catch {}
  return {
    id: Number(row.id), name: row.name, category: row.category,
    quantity: row.quantity, unit: row.unit, addedAt: row.added_at,
    expiresAt: row.expires_at, status: row.status, source: row.source,
    confidence: row.confidence, photoPath: row.photo_path, nutrition
  };
}

async function all(db, sql, args = []) {
  const r = await db.execute({ sql, args });
  return r.rows;
}
async function one(db, sql, args = []) {
  const rows = await all(db, sql, args);
  return rows[0] || null;
}
async function getItem(db, id) {
  return rowToItem(await one(db, 'SELECT * FROM items WHERE id = ?', [id]));
}

const DEMO_ITEMS = [
  ['milk','dairy',1,'liter',8,-2],['spinach','vegetable',200,'g',6,-1],['chicken breast','meat',500,'g',5,-3],
  ['banana','fruit',5,'pcs',4,2],['lettuce','vegetable',1,'head',5,2],['salmon','seafood',300,'g',1,1],['tomato','vegetable',4,'pcs',4,3],
  ['eggs','dairy',12,'pcs',2,30],['cheddar cheese','dairy',250,'g',3,25],['apple','fruit',6,'pcs',1,20],
  ['carrot','vegetable',500,'g',2,14],['orange juice','beverage',1,'liter',1,6],['white rice','grain',2,'kg',10,300],
  ['pasta','grain',500,'g',10,400],['frozen peas','frozen',400,'g',7,180]
];

async function insertDemo(db) {
  const now = Date.now();
  for (const [name, category, quantity, unit, addedAgo, expiresIn] of DEMO_ITEMS) {
    await db.execute({
      sql: `INSERT INTO items (name,category,quantity,unit,added_at,expires_at,status,source,confidence,photo_path,nutrition_json)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      args: [name, category, quantity, unit, new Date(now-addedAgo*DAY_MS).toISOString(), new Date(now+expiresIn*DAY_MS).toISOString(), 'active', 'demo', null, null, nutritionData[normalize(name)] ? JSON.stringify(nutritionData[normalize(name)]) : null]
    });
  }
  return DEMO_ITEMS.length;
}
async function seedIfEmpty(db) {
  const row = await one(db, 'SELECT COUNT(*) AS n FROM items');
  if (Number(row?.n || 0) === 0) await insertDemo(db);
}

async function createFlag(db, itemId, flagType, detail) {
  const existing = await one(db, 'SELECT id FROM reliability_flags WHERE item_id=? AND flag_type=? AND resolved=0', [itemId, flagType]);
  if (existing) return null;
  const r = await db.execute({ sql: 'INSERT INTO reliability_flags (item_id,flag_type,detail,resolved,created_at) VALUES (?,?,?,0,?)', args: [itemId, flagType, detail, new Date().toISOString()] });
  const row = await one(db, 'SELECT * FROM reliability_flags WHERE id=?', [Number(r.lastInsertRowid)]);
  return flagToApi(row);
}
function flagToApi(row) {
  return { id:Number(row.id), itemId:Number(row.item_id), flagType:row.flag_type, detail:row.detail, resolved:!!row.resolved, createdAt:row.created_at };
}

async function validateItem(db, item) {
  const flags = [];
  if (item.confidence != null && item.source !== 'manual' && item.confidence < 0.7) {
    const f = await createFlag(db, item.id, 'low_confidence', `Recognition confidence is ${Number(item.confidence).toFixed(2)} — please confirm this item.`);
    if (f) flags.push(f);
  }
  const match = findFood(item.name);
  if (!match) {
    const f = await createFlag(db, item.id, 'unknown_food', `${item.name} is not in the reference food list; no close match found.`);
    if (f) flags.push(f);
  } else if (match.matchType === 'levenshtein' && normalize(item.name) !== normalize(match.matchedName)) {
    const f = await createFlag(db, item.id, 'unknown_food', `${item.name} is not an exact match — did you mean "${match.matchedName}"?`);
    if (f) flags.push(f);
  }
  return flags;
}

async function scan(db) {
  const active = await all(db, "SELECT * FROM items WHERE status='active'");
  const created = [];
  const now = new Date();
  for (const row of active) {
    if (row.expires_at && new Date(row.expires_at) < now) {
      const f = await createFlag(db, Number(row.id), 'expired', `"${row.name}" has expired — consume or discard it.`);
      if (f) created.push(f);
    }
    if (row.expires_at && row.added_at && new Date(row.expires_at) < new Date(row.added_at)) {
      const f = await createFlag(db, Number(row.id), 'expiry_mismatch', `Impossible dates: "${row.name}" expires before it was added.`);
      if (f) created.push(f);
    }
  }
  return created;
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
function pathParts(req) {
  const url = new URL(req.url, 'https://example.invalid');
  return { parts: url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean), query: url.searchParams };
}
function daysUntil(iso) {
  const target = new Date(iso); if (Number.isNaN(target.getTime())) return null;
  const a = new Date(); a.setHours(0,0,0,0); target.setHours(0,0,0,0);
  return Math.round((target-a)/DAY_MS);
}

module.exports = async function handler(req, res) {
  try {
    const db = client();
    await init(db);
    const { parts, query } = pathParts(req);
    const method = req.method || 'GET';

    if (parts[0] === 'items' && parts.length === 1 && method === 'GET') {
      const status = query.get('status') || 'active';
      const rows = status === 'all' ? await all(db, 'SELECT * FROM items ORDER BY expires_at ASC') : await all(db, 'SELECT * FROM items WHERE status=? ORDER BY expires_at ASC', [status]);
      return json(res, 200, { items: rows.map(rowToItem) });
    }
    if (parts[0] === 'items' && parts.length === 1 && method === 'POST') {
      const b = req.body || {}; if (!String(b.name || '').trim()) return json(res, 400, { error:'name is required' });
      const name = String(b.name).trim(); const match = findFood(name);
      const category = b.category || match?.entry?.category || 'other';
      const expiresAt = b.expiresAt || estimateExpiry(name);
      const n = b.nutrition ?? nutritionData[normalize(match?.matchedName || name)] ?? null;
      const r = await db.execute({ sql:`INSERT INTO items (name,category,quantity,unit,added_at,expires_at,status,source,confidence,photo_path,nutrition_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, args:[name,category,b.quantity??null,b.unit??null,new Date().toISOString(),expiresAt,'active',b.source||'manual',b.confidence??null,b.photoPath??null,n?JSON.stringify(n):null] });
      const item = await getItem(db, Number(r.lastInsertRowid));
      return json(res, 201, { item, flags: await validateItem(db, item) });
    }
    if (parts[0] === 'items' && parts[1] && parts.length === 2 && method === 'PUT') {
      const id = Number(parts[1]); const b = req.body || {}; const allowed = {name:'name',category:'category',quantity:'quantity',unit:'unit',addedAt:'added_at',expiresAt:'expires_at',status:'status',source:'source',confidence:'confidence',photoPath:'photo_path'};
      const sets=[]; const args=[];
      for (const [k,c] of Object.entries(allowed)) if (b[k] !== undefined) { sets.push(`${c}=?`); args.push(b[k]); }
      if (b.nutrition !== undefined) { sets.push('nutrition_json=?'); args.push(b.nutrition===null?null:JSON.stringify(b.nutrition)); }
      if (sets.length) { args.push(id); await db.execute({sql:`UPDATE items SET ${sets.join(',')} WHERE id=?`,args}); }
      const item = await getItem(db,id); return item ? json(res,200,{item}) : json(res,404,{error:'item not found'});
    }
    if (parts[0] === 'items' && parts[1] && parts.length === 2 && method === 'DELETE') {
      const id=Number(parts[1]); await db.execute({sql:'DELETE FROM reliability_flags WHERE item_id=?',args:[id]}); await db.execute({sql:'DELETE FROM consumption_log WHERE item_id=?',args:[id]}); const r=await db.execute({sql:'DELETE FROM items WHERE id=?',args:[id]}); return Number(r.rowsAffected)>0?json(res,204,{}):json(res,404,{error:'item not found'});
    }
    if (parts[0] === 'items' && parts[1] && ['consume','discard'].includes(parts[2]) && method === 'POST') {
      const id=Number(parts[1]); const action=parts[2]==='consume'?'consumed':'discarded'; const item=await getItem(db,id); if(!item)return json(res,404,{error:'item not found'}); await db.execute({sql:'UPDATE items SET status=? WHERE id=?',args:[action,id]}); await db.execute({sql:'INSERT INTO consumption_log (item_id,action,at) VALUES (?,?,?)',args:[id,action,new Date().toISOString()]}); return json(res,200,{item:await getItem(db,id)});
    }
    if (parts[0] === 'alerts' && method === 'GET') {
      const items=(await all(db,"SELECT * FROM items WHERE status='active'")).map(rowToItem); const expired=[],expiringSoon=[]; for(const i of items){const d=daysUntil(i.expiresAt);if(d==null)continue;if(d<0)expired.push(i);else if(d<=SOON_DAYS)expiringSoon.push(i);} return json(res,200,{expired,expiringSoon});
    }
    if (parts[0] === 'recommendations' && method === 'GET') {
      const active=(await all(db,"SELECT * FROM items WHERE status='active'")).map(rowToItem); const expiring=active.filter(i=>{const d=daysUntil(i.expiresAt);return d!==null&&d>=0&&d<=SOON_DAYS;}); const names=expiring.map(i=>normalize(i.name)); const matched=recipes.map(r=>{const usesItems=expiring.filter(i=>r.ingredients.some(x=>normalize(x).includes(normalize(i.name))||normalize(i.name).includes(normalize(x))));return {...r,usesItems};}).filter(r=>r.usesItems.length).sort((a,b)=>b.usesItems.length-a.usesItems.length).slice(0,8); return json(res,200,{recipes:matched,removals:active.filter(i=>daysUntil(i.expiresAt)<0)});
    }
    if (parts[0] === 'insights' && method === 'GET') {
      const active=(await all(db,"SELECT * FROM items WHERE status='active'")).map(rowToItem); const counts={}; for(const i of active)counts[i.category||'other']=(counts[i.category||'other']||0)+1; const total=Math.max(active.length,1); const categoryBalance=Object.entries(counts).map(([category,count])=>({category,count,percentage:Math.round(count/total*100)})); const logs=await all(db,'SELECT action FROM consumption_log'); const discarded=logs.filter(x=>x.action==='discarded').length; const wasteRate=logs.length?Math.round(discarded/logs.length*100):0; return json(res,200,{categoryBalance,wasteRate,eatMore:[],eatLess:wasteRate>30?['Plan smaller portions to reduce waste.']:[],nutritionSummary:{trackedItems:active.length}});
    }
    if (parts[0] === 'reliability' && parts[1] === 'flags' && parts.length===2 && method==='GET') {
      const rows=await all(db,`SELECT f.*,i.name AS item_name FROM reliability_flags f LEFT JOIN items i ON i.id=f.item_id ${query.get('all')?'':'WHERE f.resolved=0'} ORDER BY f.created_at DESC`); return json(res,200,{flags:rows.map(r=>({...flagToApi(r),itemName:r.item_name}))});
    }
    if (parts[0] === 'reliability' && parts[1] === 'scan' && method==='POST') { const flags=await scan(db); return json(res,200,{created:flags.length,flags}); }
    if (parts[0] === 'reliability' && parts[1] === 'flags' && parts[2] && parts[3] === 'resolve' && method==='POST') { const id=Number(parts[2]); await db.execute({sql:'UPDATE reliability_flags SET resolved=1 WHERE id=?',args:[id]}); const row=await one(db,'SELECT * FROM reliability_flags WHERE id=?',[id]); return row?json(res,200,{flag:flagToApi(row)}):json(res,404,{error:'flag not found'}); }
    if (parts[0] === 'health' && method==='GET') { const demo=await one(db,"SELECT COUNT(*) AS n FROM items WHERE source='demo'"); return json(res,200,{db:'ok',mode:Number(demo.n)>0?'demo':'live',llm:!!process.env.LLM_API_KEY,hosting:'vercel',database:'turso'}); }
    if (parts[0] === 'demo' && parts[1] === 'reseed' && method==='POST') { const ids=await all(db,"SELECT id FROM items WHERE source='demo'"); for(const r of ids){await db.execute({sql:'DELETE FROM reliability_flags WHERE item_id=?',args:[r.id]});await db.execute({sql:'DELETE FROM consumption_log WHERE item_id=?',args:[r.id]});await db.execute({sql:'DELETE FROM items WHERE id=?',args:[r.id]});} return json(res,200,{seeded:await insertDemo(db)}); }
    return json(res,404,{error:'not found'});
  } catch (err) {
    console.error(err);
    return json(res,500,{error:err.message||'internal server error'});
  }
};
