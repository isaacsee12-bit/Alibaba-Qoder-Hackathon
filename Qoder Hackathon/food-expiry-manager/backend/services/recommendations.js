/**
 * services/recommendations.js — recipe suggestions for expiring items and
 * removal prompts for expired ones.
 */
const path = require('path');
const recipes = require(path.join(__dirname, '..', 'data', 'recipes.json'));
const inventory = require('./inventory');
const shelfLife = require('./shelfLife');
const llmClient = require('./llmClient');

const SOON_DAYS = 3;

/** Whole days from today until the given ISO date (negative = past), matching frontend util.js. */
function daysUntil(iso, now = new Date()) {
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((startOfTarget - startOfToday) / 86400000);
}

/** True when a recipe ingredient refers to the given item name (fuzzy). */
function ingredientMatchesItem(ingredient, itemName) {
  const a = shelfLife.normalize(ingredient);
  const b = shelfLife.normalize(itemName);
  if (a === b) return true;
  // resolve both through the reference catalog so "bananas" matches "banana"
  const ma = shelfLife.findMatch(a);
  const mb = shelfLife.findMatch(b);
  return !!(ma && mb && ma.matchedName === mb.matchedName);
}

async function getRecommendations() {
  const now = new Date();
  const active = inventory.list('active');

  const expiringSoon = active.filter((item) => {
    if (!item.expiresAt) return false;
    const d = daysUntil(item.expiresAt, now);
    return d !== null && d >= 0 && d <= SOON_DAYS;
  });
  const removals = active.filter((item) => {
    if (!item.expiresAt) return false;
    const d = daysUntil(item.expiresAt, now);
    return d !== null && d < 0;
  });

  // Extension point: when an LLM key is configured, prefer LLM suggestions.
  const llmRecipes = await llmClient.suggestRecipes(expiringSoon);
  if (llmRecipes) {
    return { recipes: llmRecipes, removals };
  }

  // Rule-based: recipes whose ingredients use at least one expiring item.
  const matched = [];
  for (const recipe of recipes) {
    const usesItems = [];
    for (const item of expiringSoon) {
      if (recipe.ingredients.some((ing) => ingredientMatchesItem(ing, item.name))) {
        usesItems.push({ id: item.id, name: item.name });
      }
    }
    if (usesItems.length) {
      matched.push({
        title: recipe.title,
        ingredients: recipe.ingredients,
        instructions: recipe.instructions,
        usesItems,
      });
    }
  }
  // most expiring items used first
  matched.sort((a, b) => b.usesItems.length - a.usesItems.length);

  return { recipes: matched, removals };
}

module.exports = { getRecommendations, SOON_DAYS, daysUntil };
