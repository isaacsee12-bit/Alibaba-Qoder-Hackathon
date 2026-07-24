# Deploying to Vercel

The Vercel version uses:

- **Vercel static hosting** for `frontend/`
- **One Vercel Node.js Function** for all `/api/*` routes
- **Turso/libSQL** for persistent serverless data

The original Express + local SQLite backend remains available for local development.

## 1. Create a Turso database

Create a free Turso account and database, then obtain:

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`

The API creates its tables automatically and inserts the 15 demo items when the database is empty.

## 2. Import the GitHub repository into Vercel

In Vercel:

1. Choose **Add New > Project**.
2. Import `isaacsee12-bit/Alibaba-Qoder-Hackathon`.
3. Set **Root Directory** to:

   ```text
   Qoder Hackathon/food-expiry-manager
   ```

4. Leave the framework preset as **Other**.
5. Add these environment variables:

   ```text
   TURSO_DATABASE_URL=libsql://...
   TURSO_AUTH_TOKEN=...
   ```

6. Deploy.

`vercel.json` publishes the static frontend and routes every `/api/*` request to `api/index.js`.

## 3. Verify the deployment

Open these addresses using your Vercel domain:

```text
https://YOUR-PROJECT.vercel.app/
https://YOUR-PROJECT.vercel.app/api/health
```

The health endpoint should return values similar to:

```json
{
  "db": "ok",
  "mode": "demo",
  "llm": false,
  "hosting": "vercel",
  "database": "turso"
}
```

Then verify that you can:

1. View the seeded inventory.
2. Add and edit an item.
3. Mark an item consumed or discarded.
4. View alerts and recommendations.
5. Run and resolve reliability flags.
6. Reseed demo data from Settings.

## Serverless behavior

The local backend runs a reliability scan every six hours. Vercel Functions do not stay running continuously, so the Vercel version runs reliability checks when an item is created and whenever **Run scan now** is selected. A Vercel Cron Job can be added later for scheduled scans.

## Local version

The existing local version still runs from `backend/`:

```powershell
cd "Qoder Hackathon\food-expiry-manager\backend"
npm install
npm start
```
