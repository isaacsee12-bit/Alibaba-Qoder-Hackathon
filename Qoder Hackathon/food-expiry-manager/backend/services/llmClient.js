/**
 * services/llmClient.js — optional LLM extension point.
 *
 * Reads LLM_API_KEY from .env (loaded by server.js via dotenv). Without a key
 * everything here is disabled and returns null, so callers fall back to the
 * built-in rule-based recommendations/insights.
 */

function isEnabled() {
  return !!process.env.LLM_API_KEY;
}

/**
 * Suggest recipes for the given expiring items via an LLM.
 * @returns {Promise<Array|null>} null when disabled or on any failure.
 */
async function suggestRecipes(expiringItems) {
  if (!isEnabled()) return null;
  try {
    // Real integration would go here, e.g.:
    //   const res = await fetch('https://api.openai.com/v1/chat/completions', {
    //     method: 'POST',
    //     headers: {
    //       'Authorization': `Bearer ${process.env.LLM_API_KEY}`,
    //       'Content-Type': 'application/json',
    //     },
    //     body: JSON.stringify({
    //       model: 'gpt-4o-mini',
    //       messages: [{ role: 'user', content: `Suggest simple recipes using: ${expiringItems.map(i => i.name).join(', ')}. Reply as JSON [{title, ingredients, instructions}].` }],
    //     }),
    //   });
    //   const data = await res.json();
    //   return parseRecipesFromResponse(data);
    return null; // stub: no real call wired up yet
  } catch {
    return null; // throw-safe: callers always get rule-based fallback
  }
}

/**
 * Generate personalized diet advice from inventory + insights via an LLM.
 * @returns {Promise<Object|null>} null when disabled or on any failure.
 */
async function dietAdvice(insights) {
  if (!isEnabled()) return null;
  try {
    // Real integration would go here — send the rule-based insights object as
    // context and ask the model for tailored eatMore/eatLess advice, e.g.:
    //   const res = await fetch(..., { body: JSON.stringify({ ...insights }) });
    //   return parseAdviceFromResponse(await res.json());
    return null; // stub: no real call wired up yet
  } catch {
    return null;
  }
}

module.exports = { isEnabled, suggestRecipes, dietAdvice };
