/**
 * services/insights.js — diet balance, waste rate and advice from the
 * active inventory + consumption log.
 *
 * Simple target proportions: vegetables + fruits ~50%, grains ~25%,
 * protein (meat/seafood/dairy) ~25%.
 */
const path = require('path');
const nutritionData = require(path.join(__dirname, '..', 'data', 'nutrition.json'));
const db = require('../db/db');
const inventory = require('./inventory');

// per-category targets derived from the group targets above
const CATEGORY_TARGETS = {
  vegetable: 0.3,
  fruit: 0.2,
  grain: 0.25,
  meat: 0.1,
  seafood: 0.075,
  dairy: 0.075,
  beverage: 0,
  condiment: 0,
  snack: 0,
  frozen: 0,
  other: 0,
};

const GROUPS = {
  'vegetables & fruits': ['vegetable', 'fruit'],
  grains: ['grain'],
  protein: ['meat', 'seafood', 'dairy'],
};
const GROUP_TARGETS = { 'vegetables & fruits': 0.5, grains: 0.25, protein: 0.25 };

/** A representative healthNote for a category, from nutrition.json. */
function categoryHealthNote(category) {
  const rep = shelfLifeEntriesByCategory(category)[0];
  if (rep && nutritionData[rep]) return nutritionData[rep].healthNote;
  return null;
}

const shelfLifeList = require(path.join(__dirname, '..', 'data', 'shelf_life.json'));
function shelfLifeEntriesByCategory(category) {
  return shelfLifeList.filter((e) => e.category === category).map((e) => e.name);
}

function getInsights() {
  const active = inventory.list('active');
  const total = active.length;

  // --- category balance ---
  const counts = {};
  for (const item of active) {
    const cat = item.category || 'other';
    counts[cat] = (counts[cat] || 0) + 1;
  }
  const categories = new Set([...Object.keys(CATEGORY_TARGETS), ...Object.keys(counts)]);
  const categoryBalance = [...categories].map((category) => ({
    category,
    count: counts[category] || 0,
    share: total ? +((counts[category] || 0) / total).toFixed(3) : 0,
    target: CATEGORY_TARGETS[category] ?? 0,
  })).sort((a, b) => b.count - a.count);

  // --- waste rate from consumption_log ---
  const consumed = db.get("SELECT COUNT(*) AS n FROM consumption_log WHERE action = 'consumed'").n;
  const discarded = db.get("SELECT COUNT(*) AS n FROM consumption_log WHERE action = 'discarded'").n;
  const wasteRate = consumed + discarded ? +(discarded / (consumed + discarded)).toFixed(3) : 0;

  // --- eatMore / eatLess advice from group balance gaps ---
  const eatMore = [];
  const eatLess = [];
  for (const [group, cats] of Object.entries(GROUPS)) {
    const groupCount = cats.reduce((sum, c) => sum + (counts[c] || 0), 0);
    const share = total ? groupCount / total : 0;
    const target = GROUP_TARGETS[group];
    const gap = share - target;
    if (gap < -0.1) {
      const lowestCat = cats.slice().sort((a, b) => (counts[a] || 0) - (counts[b] || 0))[0];
      const note = categoryHealthNote(lowestCat);
      eatMore.push({
        category: group,
        reason: `Only ${(share * 100).toFixed(0)}% of your food is ${group} (target ~${target * 100}%).${note ? ' ' + note : ''}`,
      });
    } else if (gap > 0.15) {
      eatLess.push({
        category: group,
        reason: `${(share * 100).toFixed(0)}% of your food is ${group}, above the ~${target * 100}% target — balance it with other groups.`,
      });
    }
  }
  // flag heavy snack/condiment/beverage load
  const treatCount = (counts.snack || 0) + (counts.beverage || 0) + (counts.condiment || 0);
  if (total && treatCount / total > 0.25) {
    eatLess.push({
      category: 'snacks & extras',
      reason: `${((treatCount / total) * 100).toFixed(0)}% of your inventory is snacks, beverages or condiments — swap some for whole foods.`,
    });
  }

  // --- nutrition summary across items that have nutrition data ---
  const withNutrition = active.filter((i) => i.nutrition && typeof i.nutrition.caloriesPer100g === 'number');
  const sum = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  for (const item of withNutrition) {
    sum.calories += item.nutrition.caloriesPer100g || 0;
    sum.protein += item.nutrition.protein || 0;
    sum.carbs += item.nutrition.carbs || 0;
    sum.fat += item.nutrition.fat || 0;
    sum.fiber += item.nutrition.fiber || 0;
  }
  const n = withNutrition.length || 1;
  const nutritionSummary = {
    activeItems: total,
    itemsWithNutrition: withNutrition.length,
    avgCaloriesPer100g: +(sum.calories / n).toFixed(1),
    avgProtein: +(sum.protein / n).toFixed(1),
    avgCarbs: +(sum.carbs / n).toFixed(1),
    avgFat: +(sum.fat / n).toFixed(1),
    avgFiber: +(sum.fiber / n).toFixed(1),
  };

  return { categoryBalance, wasteRate, eatMore, eatLess, nutritionSummary };
}

module.exports = { getInsights };
