# Personal Food Expiry Manager — Mobile-First PWA

## Summary

Greenfield build in `c:\Users\Alden Zheng\OneDrive\Documents\Qoder Hackathon` (the second workspace folder is left untouched). Architecture: **vanilla-JS mobile-first PWA frontend (no build step) + Node.js/Express/better-sqlite3 backend**, with **free in-browser CV** (Transformers.js food-101 classifier) and a **three-layer fallback chain** (CV model → deterministic mock CV → manual entry) so the demo never breaks. Everything works with **zero API keys**; an LLM extension point is stubbed for later.

Both workspace folders are empty and **Node.js/npm/Python are NOT installed** — environment setup is the first gating milestone.

## Environment Setup (gates everything)

- Install Node.js LTS via `winget install OpenJS.NodeJS.LTS` (PowerShell; use `;` not `&&`), then verify `node --version` in a fresh shell.
- Create project root: `c:\Users\Alden Zheng\OneDrive\Documents\Qoder Hackathon\food-expiry-manager\` with `backend/`, `frontend/`, `docs/`.
- Note: paths contain spaces (OneDrive) — always quote paths in commands.
- Fallback: if `better-sqlite3` native install fails on Windows, switch the DB wrapper to `sql.js` (pure WASM, same SQL, file persisted via fs write) — DB access is isolated behind one wrapper module (`backend/db/db.js`) to make this a one-file swap.

## Backend (Node + Express + SQLite)

Location: `backend/`. Dependencies kept minimal: `express`, `better-sqlite3`, `cors`, `multer`, `dotenv`.

- **Schema** (`backend/db/schema.sql`, applied by `backend/db/init.js`):
  - `items` (id, name, category, quantity, unit, added_at, expires_at, status `active|consumed|discarded`, source `cv|manual|demo`, confidence, photo_path, nutrition_json)
  - `reliability_flags` (id, item_id, flag_type `low_confidence|expiry_mismatch|unknown_food|expired`, detail, resolved)
  - `consumption_log` (id, item_id, action `consumed|discarded`, at) — feeds insights waste-rate
  - Indexes on `items(expires_at)` and `items(category)`.
- **Reference data** (JSON, human-editable):
  - `backend/data/shelf_life.json` — ~100 common foods: name, category, fridge/pantry shelf-life days.
  - `backend/data/nutrition.json` — per food: calories, protein, carbs, fat, fiber, key micronutrients, one-line health note.
  - `backend/data/recipes.json` — ~30 hardcoded recipes keyed by ingredient, used by demo-mode recommendations.
- **Services** (`backend/services/`): `inventory.js` (CRUD + consume/discard), `shelfLife.js` (fuzzy name lookup → expiry estimate), `recommendations.js` (expiring-soon recipes + expired-removal prompts), `insights.js` (category balance vs MyPlate-style proportions, waste rate, eat-more/eat-less advice from nutrition.json), `reliability.js` (see below), `llmClient.js` (extension point: if `LLM_API_KEY` in `.env` → real call; else rule-based fallback; ships disabled).
- **API contract** (exact, shared verbatim with frontend work):
  - `GET/POST /api/items`, `PUT/DELETE /api/items/:id`, `POST /api/items/:id/consume`, `POST /api/items/:id/discard`
  - `POST /api/items` body: `{name, category, quantity, expiresAt?, source, confidence?, nutrition?}` + optional multipart photo; server fills `expiresAt` from shelf-life lookup when absent.
  - `GET /api/alerts` → `{expired: Item[], expiringSoon: Item[]}` (soon = ≤3 days)
  - `GET /api/recommendations` → `{recipes: [{title, ingredients, usesItems}], removals: Item[]}`
  - `GET /api/insights` → `{categoryBalance, wasteRate, eatMore: [], eatLess: [], nutritionSummary}`
  - `GET /api/reliability/flags`, `POST /api/reliability/scan`, `POST /api/reliability/flags/:id/resolve`
  - `GET /api/health` → `{db, mode: 'demo'|'live', llm: bool}`
- **Server** (`backend/server.js`): serves API + statically serves `frontend/` so one process runs the whole app (`npm start` → http://localhost:3000).

## Reliability Bot

- **On-create validation** (`backend/services/reliability.js`): confidence ≥ 0.7 auto-accept; 0.4–0.7 accept but create `low_confidence` flag prompting user confirmation in UI; name not found in shelf_life.json → `unknown_food` flag with suggested closest match; user-set expiry outside 0.5×–2× of reference shelf life → `expiry_mismatch` flag.
- **Periodic scan**: runs on server start + every 6h via `setInterval` + manual trigger from Settings UI (`POST /api/reliability/scan`). Flags expired items still `active`, duplicates, impossible dates (expiry before added).
- **UI surface**: badge on Alerts tab; each flag shows one-tap resolutions (confirm / correct name / adjust date / discard item).

## Frontend PWA (vanilla JS, no build step)

Location: `frontend/`. Plain CSS, mobile-first (bottom tab bar), no framework.

- `index.html` + `app.js` — single-page shell with 5 tabs: **Scan, Inventory, Alerts, Insights, Settings**.
- `manifest.json` (standalone display, 192/512 icons — generate simple PNG icons) + `sw.js` (cache-first app shell, versioned cache name, network-first for `/api/*`).
- `modules/camera.js` — primary capture via `<input type="file" accept="image/*" capture="environment">` (most reliable on mobile browsers); client-side downscale to ≤512px via canvas before inference/upload.
- `modules/classifier.js` — Transformers.js (`@huggingface/transformers` via CDN ESM import) image-classification pipeline with quantized food-101 fine-tuned model (e.g. `Xenova`-converted ViT food model); runs in a **Web Worker** to keep UI responsive; model lazy-loads on first Scan use with progress indicator and is cached by the browser. **Fallback chain**: model load/inference fails or times out (15s) → deterministic mock CV (`modules/mockCv.js`: stable hash of image bytes → rotating pick from 10 common foods, always same result for same image) → manual entry form (always visible as "enter manually" option).
- `modules/inventory.js` — list grouped by urgency (expired red / ≤3 days amber / fresh green), edit, consume, discard.
- `modules/alerts.js` — expired + expiring-soon lists, reliability flag resolution cards, recipe suggestions for expiring items.
- `modules/insights.js` — category balance bars (plain CSS/divs, no chart lib), waste rate, eat-more/eat-less advice with health notes.
- `modules/settings.js` — demo-mode toggle + reseed, manual reliability scan, LLM API key field (stored to backend `.env` guidance / localStorage with warning), clear-cache button.
- `modules/api.js` — single fetch wrapper implementing the API contract above.

## Demo Mode (no-key guarantee)

- `backend/db/seed.js`: seeds ~15 items across all urgency states (some expired, some expiring in 1–3 days, some fresh) on first run or via Settings reseed; a visible **"Demo Mode"** pill shows in the header when seeded data is active.
- Bundled sample food images in `frontend/demo-images/` (3–5 images) so the Scan flow is demonstrable without a real fridge.
- All recommendations/insights are deterministic (rule-based, seeded data) so reruns look identical for judges.
- `docs/LLM_INTEGRATION.md` + `backend/.env.example`: exactly where to paste a future API key and which features upgrade (richer recipes, smarter dietary advice).

## Documentation

- `README.md` at project root: features, quick start (`npm install; npm start`), demo script for judges, architecture sketch, fallback-chain explanation.

## Execution Order & Dependencies

1. **Env setup** (Node install + scaffold) — gates all.
2. **Backend** (schema → reference data → services → server) — single coding scope.
3. **Frontend** (shell/PWA + modules) — starts after backend API contract is fixed; can overlap backend service work since contract is fully specified above.
4. **CV integration** (classifier worker + mock fallback) — after frontend shell exists.
5. **Seed/demo mode + docs** — after 2–4.
6. **Verification** — backend API smoke tests (Verify agent), then full Browser E2E.

## Test Plan

- **Verify**: `npm install` succeeds; server starts; smoke-test each API endpoint (create item with/without expiry, alerts thresholds, reliability scan creates expected flags on seeded data, insights returns advice).
- **Browser E2E** (mandatory before completion): load app at localhost:3000; confirm Demo Mode data renders; run Scan flow with a bundled sample image (accept either real CV or mock fallback result — verify item lands in Inventory with expiry date); resolve a reliability flag; check Alerts shows expired + expiring items with recipes; check Insights renders advice; verify manifest.json loads and service worker registers; confirm no console errors.
- Cleanup: stop dev server, remove any scratch files after verification.

## Risks & Mitigations

- **Node.js not installed** → first milestone installs via winget; if winget unavailable, direct MSI download instruction; abort-and-report if install impossible.
- **better-sqlite3 native build failure** → swap to sql.js behind the single `db.js` wrapper.
- **CV model too large/slow on mobile (~30–90MB quantized)** → lazy load with progress UI, Web Worker inference, 15s timeout to deterministic mock; mock + manual entry keep demo alive regardless.
- **CV misclassification** → confidence thresholds + reliability flags + one-tap correction; never silently commit low-confidence items.
- **OneDrive path spaces / file locking** → quote all paths; SQLite DB and uploads live inside project folder (acceptable for hackathon; note in README to pause sync if lock errors appear).
- **Service worker staleness during development** → versioned cache name; network-first for API; clear-cache button in Settings.

## Rejected Alternatives

- **Pure client-side SQLite-WASM app, no backend (Plan C)**: removes the Node dependency but deviates from the chosen file-based SQLite DB, makes persistence browser-quota-bound and harder to inspect/demo, and the reliability bot's periodic scans fit naturally server-side. Its fallback philosophy was kept; its architecture was not.
- **React/Vite + Workbox + IndexedDB offline sync queue (Plan B)**: build tooling, framework, and sync complexity are unjustified for a single-user hackathon app; targeted performance ideas (Web Worker inference, quantized model, image downscale, DB indexes) were absorbed instead.
- **Server-side Python/YOLO inference**: Python is only a Microsoft Store stub on this machine; adds a second runtime and heavier models for marginal gain over in-browser classification with a solid mock fallback.
- **Free hosted Hugging Face Inference API**: requires a token (user has no key) and network dependency during the demo — violates the no-key, offline-tolerant requirement.

## Assumptions

- Project is built in the `Qoder Hackathon` workspace root; the `Qoder Hackathon Final folder` remains untouched (can be copied there at the end if desired).
- Single-user, localhost usage; phone demo happens via desktop browser mobile-viewport or LAN access to the dev machine.
- Installing Node.js LTS on this machine is acceptable to the user.