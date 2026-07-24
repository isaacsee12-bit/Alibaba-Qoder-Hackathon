-- Food Expiry Manager schema (idempotent: safe to re-run on startup)

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT,
  quantity REAL,
  unit TEXT,
  added_at TEXT,
  expires_at TEXT,
  status TEXT CHECK (status IN ('active', 'consumed', 'discarded')) DEFAULT 'active',
  source TEXT CHECK (source IN ('cv', 'manual', 'demo')),
  confidence REAL,
  photo_path TEXT,
  nutrition_json TEXT
);

CREATE TABLE IF NOT EXISTS reliability_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
  flag_type TEXT CHECK (flag_type IN ('low_confidence', 'expiry_mismatch', 'unknown_food', 'expired')),
  detail TEXT,
  resolved INTEGER DEFAULT 0,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS consumption_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
  action TEXT CHECK (action IN ('consumed', 'discarded')),
  at TEXT
);

CREATE INDEX IF NOT EXISTS idx_items_expires_at ON items (expires_at);
CREATE INDEX IF NOT EXISTS idx_items_category ON items (category);
