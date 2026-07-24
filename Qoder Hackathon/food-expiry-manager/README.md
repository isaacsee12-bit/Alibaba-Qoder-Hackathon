# 🍎 Personal Food Expiry Manager

A mobile-first **Progressive Web App** that tracks the food in your kitchen, warns you before it expires, suggests recipes to use it up, and gives you dietary insights — so you waste less and eat fresher.

Built for the Qoder Hackathon. Vanilla-JS frontend, Node.js + Express + SQLite backend, zero cloud dependencies. **Works fully offline-capable and requires no API keys.**

## Features

- 📷 **Photo Scan** — snap or upload a food photo; an in-browser CV model (Transformers.js *food-101*, running in a Web Worker) identifies it on-device. A three-layer fallback chain guarantees scanning always works (see [Fallback chain](#fallback-chain)).
- 📦 **Inventory** — SQLite-backed item list with quantity, category, photo, and expiry date. Shelf life, category and nutrition are auto-filled from a built-in reference of **115 common foods** (`backend/data/shelf_life.json`) when you don't provide them.
- 🔔 **Expiry Alerts** — items are classified as *expired* or *expiring soon* (≤ 3 days); an alert badge appears on the tab bar.
- 🍳 **Recipe Recommendations** — 32 built-in recipes (`backend/data/recipes.json`) matched (fuzzily) against your expiring items, sorted by how many expiring items each recipe uses.
- 🛡 **Reliability Bot** — validates every new item on creation (`low_confidence`, `unknown_food`, `expiry_mismatch` flags) and scans the whole inventory on server start, every 6 hours, and on demand (`expired` items, duplicates, impossible dates). Flags can be reviewed and resolved in the UI, including an "apply suggested name" action for near-miss food names.
- 📊 **Dietary Insights** — category balance vs. simple targets (vegetables + fruits ~50 %, grains ~25 %, protein ~25 %), waste rate from your consume/discard history, "eat more / eat less" advice, and a nutrition summary.
- 🎬 **Demo Mode** — the database auto-seeds with 15 sample items (3 expired, 4 expiring soon, 8 fresh) on first run; a *Demo Mode* pill shows in the header. Reseed anytime from Settings. Four sample food images ship in `frontend/demo-images/` for scanning without a camera.
- 🤖 **LLM extension point** — optional; see [docs/LLM_INTEGRATION.md](docs/LLM_INTEGRATION.md). The app is 100 % functional without any key.
- 📱 **PWA** — installable, service worker caches the app shell and demo images for offline use.

## Quick start (Windows PowerShell)

Prerequisites: [Node.js](https://nodejs.org/) 18+ (includes npm).

```powershell
cd "food-expiry-manager\backend"
npm install
npm start
```

Then open **http://localhost:3000** in your browser. The backend serves both the API and the frontend — no separate frontend build or server is needed.

Notes:

- PowerShell doesn't support `&&` as a separator — use `;` instead, e.g. `cd backend; npm install; npm start`.
- If you see *"npm.ps1 cannot be loaded because running scripts is disabled"*, call the CMD shim instead: `npm.cmd install` and `npm.cmd start` (or run once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`).
- To use a different port, copy `backend/.env.example` to `backend/.env` and set `PORT`.

> ⚠️ **OneDrive warning:** this project lives inside a OneDrive-synced folder. SQLite writes to `backend/db/food.db` (plus `-wal`/`-shm` sidecar files), and OneDrive sync can briefly lock these files, causing `SQLITE_BUSY` / file-lock errors. If that happens, **pause OneDrive syncing** while running the app (system tray → OneDrive → Pause syncing), or move the project outside OneDrive. Alternatively, set `DB_PATH` in `backend/.env` to a database file location outside OneDrive.

## Demo script (for judges)

A ~3-minute walkthrough that touches every feature:

1. **Start the server** (`npm start` in `backend/`) and open http://localhost:3000. Note the green **Demo Mode** pill in the header — the database was auto-seeded with 15 sample items.
2. **Scan** tab → pick one of the bundled sample images (Banana / Apple / Bread / Tomato) or upload your own photo. Watch the on-device model download and classify (first run downloads the model; if it's slow or unavailable, the app seamlessly shows *"Using quick estimate…"* — the fallback chain at work). Confirm the pre-filled name, category and expiry, then save.
3. **Inventory** tab → the scanned item appears with an auto-filled expiry date from the shelf-life reference. Try marking an item *consumed* or *discarded* (this feeds the waste-rate insight).
4. **Alerts** tab → see the seeded **expired** items (milk, spinach, chicken breast) and **expiring soon** items (salmon, banana, lettuce, tomato), plus **recipe suggestions** that use the expiring items and removal prompts for the expired ones.
5. **Reliability flags** → the bot has already flagged the expired items (it scans on startup). Resolve a flag and watch the alert badge update. (Try adding an item with a made-up name like "flurb" via manual entry to trigger an `unknown_food` flag live.)
6. **Insights** tab → category balance bars vs. targets, waste rate, *eat more / eat less* advice, and the nutrition summary.
7. **Settings** tab → **Reseed demo data** to reset to a fresh 15-item state, and **Run scan now** to trigger a reliability scan on demand. Note the LLM key field — a display-only extension point (real integration lives in `backend/.env`, see [docs/LLM_INTEGRATION.md](docs/LLM_INTEGRATION.md)).

## Architecture

```
┌────────────────────────────── Browser ──────────────────────────────┐
│  PWA (vanilla JS, frontend/)                                        │
│  ┌───────────┐ ┌───────────┐ ┌────────┐ ┌──────────┐ ┌──────────┐   │
│  │   Scan    │ │ Inventory │ │ Alerts │ │ Insights │ │ Settings │   │
│  └─────┬─────┘ └───────────┘ └────────┘ └──────────┘ └──────────┘   │
│        │ image                                                      │
│  ┌─────▼──────────────────────────────┐   ┌───────────────────┐     │
│  │ classifier.js (main-thread facade) │   │ sw.js             │     │
│  │  └─ classifier.worker.js           │   │ (offline caching) │     │
│  │     Transformers.js food-101 model │   └───────────────────┘     │
│  │  └─ mockCv.js (deterministic       │                             │
│  │     fallback, "quick estimate")    │                             │
│  └────────────────────────────────────┘                             │
└───────────────────────┬─────────────────────────────────────────────┘
                        │ fetch /api/* (JSON, multipart photo upload)
┌───────────────────────▼─────────────────────────────────────────────┐
│  Express API + static host (backend/server.js, port 3000)           │
│  ┌───────────┐ ┌────────────────┐ ┌──────────┐ ┌───────────────┐    │
│  │ inventory │ │recommendations │ │ insights │ │ reliability   │    │
│  │           │ │  └─ llmClient  │ │          │ │ (6h bot scan) │    │
│  └─────┬─────┘ └───────┬────────┘ └────┬─────┘ └──────┬────────┘    │
│        │               │               │              │             │
│  ┌─────▼───────────────▼───────────────▼──────────────▼──────────┐  │
│  │ SQLite (better-sqlite3, db/food.db)   +   reference JSON data │  │
│  │ items, actions, reliability_flags     shelf_life / recipes /  │  │
│  │                                       nutrition (data/*.json) │  │
│  └────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

Key points:

- **One process serves everything**: `server.js` hosts the static frontend, uploaded photos (`backend/uploads/`), and the JSON API.
- **CV runs entirely in the browser** (Web Worker) — no image ever needs to leave the device for classification; the photo upload to the backend is just for the inventory thumbnail.
- **Reference data is plain JSON** — shelf life (115 foods), recipes (32), and nutrition facts — so no external services are required.

### API surface

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/items?status=active\|consumed\|discarded\|all` | List items |
| POST | `/api/items` | Create item (multipart, optional `photo`; autofills category/expiry/nutrition) |
| PUT / DELETE | `/api/items/:id` | Update / delete item |
| POST | `/api/items/:id/consume` · `/api/items/:id/discard` | Log consumption / waste |
| GET | `/api/alerts` | Expired + expiring-soon items |
| GET | `/api/recommendations` | Recipe matches + removal prompts |
| GET | `/api/insights` | Category balance, waste rate, advice, nutrition |
| GET | `/api/reliability/flags?all=1` | List flags |
| POST | `/api/reliability/scan` · `/api/reliability/flags/:id/resolve` | Run scan / resolve flag |
| GET | `/api/health` | DB check, demo/live mode, LLM enabled |
| POST | `/api/demo/reseed` | Reset to fresh demo data |

## Fallback chain

Scanning is designed to **never dead-end**, even offline or on a locked-down device:

1. **On-device CV model** — `classifier.worker.js` lazy-loads a Transformers.js *food-101* image classifier in a Web Worker on first scan (with download progress shown). Results include a confidence score and alternative labels.
2. **Mock CV ("quick estimate")** — if the model can't load or doesn't answer within 15 s (no network, unsupported browser, worker crash), `mockCv.js` takes over: a deterministic FNV-1a hash of the image bytes maps to a fixed 10-food list, so the same image always yields the same result. The UI labels these results *"quick estimate"* instead of *"on-device AI"*.
3. **Manual entry / correction** — every scan result lands in an editable confirmation form (name, category, quantity, expiry), and a fully manual "add item" path exists too. The Reliability Bot then double-checks whatever was saved.

Downstream, the same philosophy applies: missing expiry dates are estimated from the shelf-life reference, and the LLM extension point silently falls back to the rule-based engine when no key is configured.

## Project layout

```
food-expiry-manager/
├── backend/
│   ├── server.js            # Express API + static frontend host
│   ├── db/                  # schema, init, demo seeder, food.db (SQLite)
│   ├── data/                # shelf_life.json, recipes.json, nutrition.json
│   ├── services/            # inventory, shelfLife, recommendations,
│   │                        # insights, reliability, llmClient
│   ├── uploads/             # uploaded item photos
│   └── .env.example         # PORT, LLM_API_KEY (optional)
├── frontend/
│   ├── index.html, app.js, styles.css, sw.js, manifest.json
│   ├── modules/             # per-tab views + camera/classifier/mockCv/api
│   └── demo-images/         # bundled sample photos for the demo
└── docs/
    └── LLM_INTEGRATION.md   # where a future LLM API key plugs in
```

## LLM integration (optional)

The app ships with a disabled-by-default LLM extension point in `backend/services/llmClient.js`, gated on `LLM_API_KEY` in `backend/.env`. See **[docs/LLM_INTEGRATION.md](docs/LLM_INTEGRATION.md)** for exactly where the key goes and what it would upgrade.
