# LLM Integration Guide

The Food Expiry Manager is **fully functional without any LLM or API key** — recipes and dietary advice come from a built-in rule-based engine. This document explains where a future LLM API key plugs in, how the code gates on it, and what would improve once a real integration is wired up.

## Where to paste the API key

The one and only real integration point is the backend `.env` file:

1. Copy the example file (from `food-expiry-manager/backend/`):

   ```powershell
   cd backend
   Copy-Item .env.example .env
   ```

2. Open `backend/.env` and paste your key on the `LLM_API_KEY` line:

   ```dotenv
   # Server port (default 3000)
   PORT=3000

   # Optional LLM API key for AI-powered recipe suggestions and diet advice.
   LLM_API_KEY=sk-your-key-here
   ```

3. Restart the server (`npm start`). You can verify the key was picked up via `GET /api/health`, which reports `"llm": true` when a key is present.

`backend/.env` is git-ignored, so the key never ends up in version control. `server.js` loads it at startup with `dotenv`.

## How `llmClient.js` gates on the key

All LLM logic lives in [`backend/services/llmClient.js`](../backend/services/llmClient.js). It exposes three functions:

| Function | Behaviour without a key | Behaviour with a key |
|---|---|---|
| `isEnabled()` | `false` (`LLM_API_KEY` empty/unset) | `true` |
| `suggestRecipes(expiringItems)` | returns `null` immediately | would call the LLM (currently a documented stub that still returns `null`) |
| `dietAdvice(insights)` | returns `null` immediately | same — documented stub |

The gating pattern is deliberately throw-safe: every function checks `isEnabled()` first and wraps any (future) network call in `try/catch` that returns `null`. **Callers treat `null` as "use the rule-based engine"**, so a missing key, a bad key, or a failed API call can never break the app.

The consumer side is in [`backend/services/recommendations.js`](../backend/services/recommendations.js):

```js
// Extension point: when an LLM key is configured, prefer LLM suggestions.
const llmRecipes = await llmClient.suggestRecipes(expiringSoon);
if (llmRecipes) {
  return { recipes: llmRecipes, removals };
}
// ...otherwise fall through to the rule-based recipe matcher
```

To complete the integration, fill in the fetch call sketched in the comments inside `suggestRecipes()` / `dietAdvice()` (an OpenAI-style chat-completions example is included in the code) and parse the response into the same shape the rule-based engine returns — no other file needs to change.

## What would upgrade with a key

- **Richer recipe suggestions** — instead of matching expiring items against the 32 fixed recipes in `backend/data/recipes.json`, the LLM could generate novel recipes that combine *all* of your expiring items at once, respect quantities on hand, and adapt to cuisines or dietary restrictions.
- **Smarter dietary advice** — instead of the rule-based category-balance targets in `backend/services/insights.js` (vegetables + fruits ~50 %, grains ~25 %, protein ~25 %), the LLM could produce personalized *eat more / eat less* guidance from your full inventory, waste history and nutrition data. `dietAdvice()` is designed to receive the rule-based insights object as context.

Everything else — scanning, inventory, alerts, the reliability bot, demo mode — is unaffected by the key and stays fully local.

## About the Settings-page key field

The **Settings → LLM API key** field in the app is a **client-side, display-only extension point** (see [`frontend/modules/settings.js`](../frontend/modules/settings.js)). It stores the value in the browser's `localStorage` under `fem.llmKey` and **nothing reads it** — it is never sent to the backend or any LLM provider, and the UI itself warns that localStorage keys are visible to anyone using the browser.

**The real integration point is `backend/.env`**, as described above. Never paste a production key into the Settings field.
