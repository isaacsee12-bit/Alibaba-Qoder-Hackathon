# Personal Food Expiry Manager

A mobile-first Progressive Web App for tracking food, estimating expiry dates, surfacing expiry alerts, suggesting recipes, and reviewing basic dietary insights.

The project supports two deployment modes:

- **Local:** Node.js, Express, and a local SQLite database.
- **Online:** Vercel Functions and a persistent Turso/libSQL database.

## Features

- On-device food image classification with deterministic and manual fallbacks
- Inventory management with quantities, categories, and expiry dates
- Expired and expiring-soon alerts
- Recipe recommendations using expiring ingredients
- Consume/discard history and waste-rate insights
- Reliability flags for uncertain recognition, unknown foods, and invalid dates
- Fifteen seeded demo items
- Installable mobile-first PWA interface

## Project location

The application is inside:

```text
Qoder Hackathon/food-expiry-manager/
```

## Run locally

Requirements: Node.js 18 or newer.

```powershell
cd "Qoder Hackathon\food-expiry-manager\backend"
npm install
npm start
```

Open:

```text
http://localhost:3000
```

The local backend serves both the API and frontend. Local data is stored in `backend/db/food.db`.

## Deploy online with Vercel

The Vercel version uses Turso because Vercel Functions cannot persist a local SQLite file.

### Required services

- A Vercel account
- A free Turso database

### Required environment variables

```text
TURSO_DATABASE_URL=libsql://...
TURSO_AUTH_TOKEN=...
```

### Vercel setup

1. Import `isaacsee12-bit/Alibaba-Qoder-Hackathon` into Vercel.
2. Set the Vercel **Root Directory** to:

   ```text
   Qoder Hackathon/food-expiry-manager
   ```

3. Use the **Other** framework preset.
4. Add `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` under Vercel Environment Variables.
5. Deploy.

The repository now includes:

- `vercel.json` for static and API routing
- `api/index.js` as the Vercel serverless API
- a root-level application `package.json` for Vercel dependencies
- `.env.example` for required environment variables

The database tables and demo data are created automatically on the first API request.

Full instructions: [`Qoder Hackathon/food-expiry-manager/docs/VERCEL_DEPLOYMENT.md`](Qoder%20Hackathon/food-expiry-manager/docs/VERCEL_DEPLOYMENT.md)

## Verify a Vercel deployment

Open:

```text
https://YOUR-PROJECT.vercel.app/api/health
```

A working deployment returns a response similar to:

```json
{
  "db": "ok",
  "mode": "demo",
  "llm": false,
  "hosting": "vercel",
  "database": "turso"
}
```

Then test adding, editing, consuming, discarding, and reseeding items.

## Architecture

```text
Browser/PWA
    |
    | /api/*
    v
Local mode:   Express server -> SQLite file
Vercel mode:  Vercel Function -> Turso/libSQL
```

The frontend uses the same `/api/*` contract in both modes.

## Important serverless difference

The local Express process runs a reliability scan every six hours. Vercel Functions do not remain active continuously, so the Vercel version runs checks when an item is created and when the user selects **Run scan now**. Scheduled scanning can later be added with Vercel Cron.

## Main folders

```text
Qoder Hackathon/food-expiry-manager/
├── api/                 # Vercel serverless API
├── backend/             # local Express + SQLite backend
├── frontend/            # PWA interface
├── docs/                # deployment and integration documentation
├── package.json         # Vercel dependencies
└── vercel.json          # Vercel routing/build configuration
```

## Optional LLM integration

The application works without an LLM API key. The existing integration point can be enabled later using `LLM_API_KEY`.
