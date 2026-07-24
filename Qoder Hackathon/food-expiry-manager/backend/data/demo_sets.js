// Curated demo inventories. Reseeding rotates to the next set so the result always changes.
// Row format: [name, category, quantity, unit, addedDaysAgo, expiresInDays]
const DEMO_SETS = [
  [
    ['milk', 'dairy', 1, 'liter', 8, -2],
    ['spinach', 'vegetable', 200, 'g', 6, -1],
    ['chicken breast', 'meat', 500, 'g', 5, -3],
    ['banana', 'fruit', 5, 'pcs', 4, 2],
    ['lettuce', 'vegetable', 1, 'head', 5, 2],
    ['salmon', 'seafood', 300, 'g', 1, 1],
    ['tomato', 'vegetable', 4, 'pcs', 4, 3],
    ['eggs', 'dairy', 12, 'pcs', 2, 30],
    ['cheddar cheese', 'dairy', 250, 'g', 3, 25],
    ['apple', 'fruit', 6, 'pcs', 1, 20],
    ['carrot', 'vegetable', 500, 'g', 2, 14],
    ['orange juice', 'beverage', 1, 'liter', 1, 6],
    ['white rice', 'grain', 2, 'kg', 10, 300],
    ['pasta', 'grain', 500, 'g', 10, 400],
    ['frozen peas', 'frozen', 400, 'g', 7, 180],
  ],
  [
    ['yogurt', 'dairy', 4, 'cups', 12, -1],
    ['strawberry', 'fruit', 250, 'g', 7, -2],
    ['ground beef', 'meat', 400, 'g', 5, -1],
    ['broccoli', 'vegetable', 2, 'heads', 4, 2],
    ['avocado', 'fruit', 3, 'pcs', 3, 1],
    ['tofu', 'protein', 300, 'g', 2, 3],
    ['mushroom', 'vegetable', 200, 'g', 4, 2],
    ['grapes', 'fruit', 500, 'g', 1, 10],
    ['butter', 'dairy', 250, 'g', 5, 45],
    ['potato', 'vegetable', 1, 'kg', 6, 28],
    ['oat milk', 'beverage', 1, 'liter', 1, 8],
    ['whole wheat bread', 'grain', 1, 'loaf', 1, 5],
    ['canned beans', 'protein', 4, 'cans', 20, 500],
    ['rolled oats', 'grain', 750, 'g', 14, 240],
    ['frozen berries', 'frozen', 500, 'g', 4, 150],
  ],
  [
    ['cream cheese', 'dairy', 200, 'g', 14, -2],
    ['raspberry', 'fruit', 180, 'g', 6, -1],
    ['prawns', 'seafood', 350, 'g', 4, -2],
    ['cucumber', 'vegetable', 2, 'pcs', 3, 2],
    ['pear', 'fruit', 5, 'pcs', 5, 3],
    ['bell pepper', 'vegetable', 3, 'pcs', 4, 2],
    ['cooked rice', 'grain', 500, 'g', 2, 1],
    ['blueberries', 'fruit', 250, 'g', 1, 8],
    ['mozzarella', 'dairy', 200, 'g', 2, 18],
    ['sweet potato', 'vegetable', 800, 'g', 3, 21],
    ['soy milk', 'beverage', 1, 'liter', 1, 7],
    ['sourdough bread', 'grain', 1, 'loaf', 1, 6],
    ['lentils', 'protein', 600, 'g', 12, 320],
    ['quinoa', 'grain', 500, 'g', 15, 360],
    ['frozen corn', 'frozen', 450, 'g', 8, 170],
  ],
];

function nextDemoSet(currentNames = []) {
  const normalized = new Set(currentNames.map((name) => String(name).toLowerCase().trim()));
  const currentIndex = DEMO_SETS.findIndex((set) => normalized.has(set[0][0]));
  return DEMO_SETS[(currentIndex + 1 + DEMO_SETS.length) % DEMO_SETS.length];
}

module.exports = { DEMO_SETS, nextDemoSet };
