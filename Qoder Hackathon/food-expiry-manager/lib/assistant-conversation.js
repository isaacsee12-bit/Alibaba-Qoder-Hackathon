const DAY_MS = 86400000;
const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_TEXT = 1200;

function normalizeRole(value) {
  const role = String(value || '').trim().toLowerCase();
  if (role === 'user') return 'user';
  if (role === 'assistant' || role === 'bot') return 'assistant';
  return null;
}

function cleanHistory(value, currentQuestion = '') {
  const current = String(currentQuestion || '').trim();
  const history = (Array.isArray(value) ? value : [])
    .map((entry) => {
      const role = normalizeRole(entry?.role);
      const text = String(entry?.text || entry?.content || '').trim().slice(0, MAX_HISTORY_TEXT);
      return role && text ? { role, text } : null;
    })
    .filter(Boolean)
    .slice(-MAX_HISTORY_MESSAGES);

  if (
    current
    && history.length
    && history[history.length - 1].role === 'user'
    && history[history.length - 1].text === current
  ) {
    history.pop();
  }
  return history;
}

function buildContextualQuestion(question, history) {
  const current = String(question || '').trim().slice(0, 600);
  const clean = cleanHistory(history, current);
  if (!clean.length || current.length > 420) return current;

  const suffix = `\nCurrent user message: ${current}\nAnswer the current message directly. An explicit new meal or recipe request replaces the previous request. Only resolve "it", "that meal", or "the recipe" from history when the current message is genuinely a follow-up.`;
  const maxPrefixLength = Math.max(0, 590 - suffix.length);
  const lines = [];
  let used = 'Recent conversation:\n'.length;

  for (let index = clean.length - 1; index >= 0; index -= 1) {
    const entry = clean[index];
    const label = entry.role === 'user' ? 'User' : 'FreshTrack';
    const available = maxPrefixLength - used - label.length - 3;
    if (available < 24) break;
    const text = entry.text.slice(0, Math.min(220, available));
    lines.unshift(`${label}: ${text}`);
    used += label.length + text.length + 3;
  }

  if (!lines.length) return current;
  return `Recent conversation:\n${lines.join('\n')}${suffix}`.slice(0, 600);
}

function daysUntil(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - Date.now()) / DAY_MS);
}

function usableItems(items) {
  return (Array.isArray(items) ? items : []).filter((item) => {
    if (!item?.expiresAt) return Boolean(item?.name);
    const days = daysUntil(item.expiresAt);
    return Boolean(item?.name) && days !== null && days >= 0;
  });
}

function sortedUsableItems(items) {
  return usableItems(items)
    .map((item) => ({ ...item, days: daysUntil(item.expiresAt) }))
    .sort((a, b) => {
      const aDays = a.days === null ? Number.POSITIVE_INFINITY : a.days;
      const bDays = b.days === null ? Number.POSITIVE_INFINITY : b.days;
      return aDays - bDays;
    });
}

function urgentNames(items, limit = 5) {
  return sortedUsableItems(items).slice(0, limit).map((item) => item.name);
}

function findName(items, patterns) {
  return usableItems(items).find((item) => patterns.some((pattern) => pattern.test(String(item.name || ''))))?.name || null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function planSignature(plan) {
  return `${plan.title}|${plan.ingredients.join('|')}`.toLowerCase();
}

function buildMealPlans(items) {
  const usable = usableItems(items);
  const urgent = urgentNames(usable, 8);
  const carrot = findName(usable, [/carrot/i]);
  const peas = findName(usable, [/\bpeas?\b/i]);
  const cheese = findName(usable, [/cheddar/i, /cheese/i]);
  const rice = findName(usable, [/\brice\b/i]);
  const bread = findName(usable, [/bread/i, /wrap/i, /tortilla/i]);
  const protein = findName(usable, [/chicken/i, /beef/i, /pork/i, /tofu/i, /\begg/i, /fish/i, /tuna/i, /salmon/i, /beans?/i, /lentils?/i]);
  const vegetables = usable
    .filter((item) => /vegetable/i.test(String(item.category || ''))
      || /carrot|pea|lettuce|tomato|spinach|broccoli|pepper|onion|cabbage|corn/i.test(String(item.name || '')))
    .map((item) => item.name)
    .slice(0, 4);

  const plans = [];

  if (carrot && peas && cheese) {
    plans.push({
      id: 'vegetable-skillet',
      title: `15-minute ${carrot}, ${peas} and ${cheese} skillet`,
      ingredients: unique([carrot, peas, cheese, rice]),
      proteinLevel: protein ? 'high' : 'moderate',
      steps: [
        `Slice the ${carrot} thinly so it cooks quickly.`,
        `Put the ${carrot} in a covered pan with a small splash of water and cook for about 5 minutes.`,
        `Add the ${peas} and cook for another 3 to 4 minutes, stirring once or twice.`,
        `Lower the heat, add the ${cheese}, cover, and let it melt for 1 to 2 minutes.`,
        rice ? `Serve over warmed ${rice} if it is already cooked.` : 'Serve immediately while hot.',
      ],
    });
  }

  if (rice && (protein || vegetables.length || cheese)) {
    const additions = unique([protein, ...vegetables, cheese]).slice(0, 4);
    plans.push({
      id: 'rice-bowl',
      title: `${additions.join(', ')} rice bowl`,
      ingredients: unique([rice, ...additions]),
      proteinLevel: protein ? 'high' : cheese || peas ? 'moderate' : 'low',
      steps: [
        `Warm the ${rice}; use already-cooked rice for a quick meal.`,
        protein ? `Cook or reheat the ${protein} thoroughly.` : `Cut the ${additions[0]} into small pieces.`,
        `Cook ${additions.filter((name) => name !== protein && name !== cheese).join(', ') || 'the vegetables'} until tender and hot.`,
        cheese ? `Stir in the ${cheese} at the end so it melts.` : 'Combine the cooked ingredients.',
        `Serve everything over the ${rice}.`,
      ],
    });
  }

  if (bread && (protein || cheese) && vegetables.length) {
    const filling = unique([protein, cheese, ...vegetables]).slice(0, 4);
    plans.push({
      id: 'sandwich',
      title: `${filling.join(', ')} sandwich`,
      ingredients: unique([bread, ...filling]),
      proteinLevel: protein ? 'high' : 'moderate',
      steps: [
        `Prepare the ${filling.join(', ')} and discard anything showing signs of spoilage.`,
        protein ? `Cook or reheat the ${protein} until fully cooked and hot.` : 'Slice the filling into bite-sized pieces.',
        `Layer the filling on the ${bread}.`,
        'Toast in a dry covered pan for 2 to 3 minutes per side if preferred.',
        'Serve immediately.',
      ],
    });
  }

  if (rice && carrot && peas) {
    plans.push({
      id: 'rice-soup',
      title: `${carrot} and ${peas} rice soup`,
      ingredients: unique([rice, carrot, peas, cheese]),
      proteinLevel: cheese || peas ? 'moderate' : 'low',
      steps: [
        `Slice the ${carrot} thinly.`,
        `Simmer the ${carrot} in water for 6 to 8 minutes until nearly tender.`,
        `Add the ${peas} and already-cooked ${rice}, then simmer for 3 minutes.`,
        cheese ? `Remove from the heat and stir in the ${cheese}.` : 'Season only with items you already have.',
        'Serve hot after checking each ingredient for spoilage.',
      ],
    });
  }

  if (protein && vegetables.length) {
    plans.push({
      id: 'protein-vegetable-pan',
      title: `${protein} with ${vegetables.join(', ')}`,
      ingredients: unique([protein, ...vegetables, rice]),
      proteinLevel: 'high',
      steps: [
        `Cut the ${protein} and vegetables into even pieces.`,
        `Cook the ${protein} thoroughly first.`,
        `Add ${vegetables.join(', ')} and cook until tender.`,
        rice ? `Serve with warmed ${rice}.` : 'Serve immediately.',
        'Check doneness and food condition before eating.',
      ],
    });
  }

  if (!plans.length) {
    const selected = urgent.slice(0, 4);
    plans.push({
      id: 'pantry-skillet',
      title: `Pantry skillet with ${selected.join(', ') || 'your available food'}`,
      ingredients: selected,
      proteinLevel: 'unknown',
      steps: [
        `Cut ${selected.join(', ') || 'the available ingredients'} into small, even pieces.`,
        'Start with the firmest ingredient in a covered pan with a splash of water.',
        'Add the remaining ingredients in order of how quickly they cook.',
        'Cook until every ingredient that requires cooking is properly hot and done.',
        'Serve immediately and discard anything showing signs of spoilage.',
      ],
    });
  }

  const seen = new Set();
  return plans.filter((plan) => {
    const signature = planSignature(plan);
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function formatPlan(plan, intro = '') {
  const ingredients = plan.ingredients.length
    ? `\n\nIngredients from your inventory: ${plan.ingredients.join(', ')}.`
    : '';
  const steps = plan.steps.map((step, index) => `${index + 1}. ${step}`).join('\n');
  return `${intro ? `${intro}\n\n` : ''}${plan.title}${ingredients}\n\n${steps}`;
}

function summarizePlan(plan, intro = 'Try') {
  return `${intro} ${plan.title}. It uses ${plan.ingredients.join(', ')} from your inventory.\n\nAsk “How do I make it?” for the exact steps.`;
}

function lastMealPlan(history, plans) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].role !== 'assistant') continue;
    const text = history[index].text.toLowerCase();
    const match = plans.find((plan) => text.includes(plan.title.toLowerCase()));
    if (match) return match;
  }
  return null;
}

function previouslyUsedSignatures(history, plans) {
  const used = new Set();
  for (const entry of history) {
    if (entry.role !== 'assistant') continue;
    const text = entry.text.toLowerCase();
    for (const plan of plans) {
      if (text.includes(plan.title.toLowerCase())) used.add(planSignature(plan));
    }
  }
  return used;
}

function isHowToFollowUp(question) {
  const lower = String(question || '').trim().toLowerCase();
  return /^(?:how (?:do|can|should) i (?:make|cook|prepare) (?:it|that|this|the meal|the recipe)|how to (?:make|cook|prepare) (?:it|that|this|the meal|the recipe)|show me (?:the )?(?:steps|method)|give me (?:the )?steps|what are the steps|steps|instructions|method)\b/.test(lower);
}

function isIngredientFollowUp(question) {
  return /^(?:what ingredients|ingredients do i need|what do i need|which ingredients)(?:\s+(?:for it|for that|for the meal|for the recipe))?[!?.\s]*$/i.test(String(question || ''));
}

function isTimingFollowUp(question) {
  return /^(?:how long (?:does it take|should i cook it|do i cook it)|what(?:'s| is) the cooking time|cooking time|cook time|timing)[!?.\s]*$/i.test(String(question || ''));
}

function isReplacementFollowUp(question) {
  return /\b(?:replace|substitute|swap|instead of)\b/i.test(String(question || ''))
    && /\b(?:it|that|this|ingredient|meal|recipe|cheese|rice|carrot|peas?)\b/i.test(String(question || ''));
}

function classifyFoodIntent(question, history, plans) {
  const lower = String(question || '').trim().toLowerCase();
  if (/\b(?:another|different|something else|new)\b.*\b(?:recipe|meal|dish)\b|\b(?:recipe|meal|dish)\b.*\b(?:another|different|something else|new)\b/.test(lower)) {
    return 'variation';
  }
  if (/\bhigh[\s-]*protein\b|\bmore protein\b|\bprotein-rich\b/.test(lower)) return 'high-protein';
  if (/\b(?:expires?|expiring|expiry|use first|reduce waste|food waste|soonest)\b/.test(lower)) return 'expiry-meal';
  if (/\b15\s*-?\s*minutes?\b|\bquick\b|\bfast\b/.test(lower)) return 'quick-meal';
  if (/\bhealthy|healthier|balanced\b/.test(lower)) return 'healthy-meal';
  if (/\b(?:suggest|recommend|give me|what should i|what can i)\b.*\b(?:meal|recipe|cook|eat|make)\b|\b(?:meal|recipe)\b/.test(lower)) {
    return 'new-meal';
  }

  const previousMeal = lastMealPlan(history, plans);
  if (previousMeal && isHowToFollowUp(lower)) return 'how-to';
  if (previousMeal && isIngredientFollowUp(lower)) return 'ingredients';
  if (previousMeal && isTimingFollowUp(lower)) return 'timing';
  if (previousMeal && isReplacementFollowUp(lower)) return 'replacement';
  if (!previousMeal && (isHowToFollowUp(lower) || isIngredientFollowUp(lower) || isTimingFollowUp(lower))) {
    return 'missing-reference';
  }
  return 'new-meal';
}

function choosePlan(intent, plans, history) {
  if (!plans.length) return null;
  if (intent === 'variation') {
    const used = previouslyUsedSignatures(history, plans);
    return plans.find((plan) => !used.has(planSignature(plan))) || plans[(used.size + 1) % plans.length];
  }
  if (intent === 'high-protein') {
    return plans.find((plan) => plan.proteinLevel === 'high')
      || plans.find((plan) => plan.proteinLevel === 'moderate')
      || plans[0];
  }
  if (intent === 'expiry-meal') return plans[0];
  if (intent === 'quick-meal') {
    return plans.find((plan) => /15-minute|sandwich|skillet/i.test(plan.title)) || plans[0];
  }
  if (intent === 'healthy-meal') {
    return plans.find((plan) => /vegetable|soup|bowl/i.test(plan.title)) || plans[0];
  }
  return plans[0];
}

function goalNote(goals) {
  return goals.length
    ? `\n\nNutrition goals: ${goals.join(', ')}. Adjust portions and choose the listed items that best fit those goals.`
    : '';
}

function fallbackAnswer(question, items, goals = [], history = []) {
  const clean = cleanHistory(history, question);
  if (!Array.isArray(items) || !items.length) {
    return 'Your inventory is empty. Add or scan some food first, then I can suggest what to cook and explain the steps.';
  }

  const usable = usableItems(items);
  if (!usable.length) {
    return 'Everything with a usable date in your inventory appears expired. Review and remove those items, then add fresh food before cooking.';
  }

  const plans = buildMealPlans(usable);
  const intent = classifyFoodIntent(question, clean, plans);
  const previousMeal = lastMealPlan(clean, plans);

  if (intent === 'missing-reference') {
    return 'I do not have a previous meal to refer to. Ask for a meal first, or name the dish you want instructions for.';
  }

  if (intent === 'how-to') return formatPlan(previousMeal, 'Here is how to make the meal I just suggested:');
  if (intent === 'timing') return formatPlan(previousMeal, 'Here is the timed method for the meal I just suggested:');
  if (intent === 'ingredients') {
    return `For ${previousMeal.title}, use: ${previousMeal.ingredients.join(', ')}. Check every item for signs of spoilage before cooking.`;
  }
  if (intent === 'replacement') {
    return `For ${previousMeal.title}, tell me the exact ingredient you want to replace. I will only suggest a substitute that is already in your inventory.`;
  }

  const plan = choosePlan(intent, plans, clean);
  if (!plan) return 'I could not build a meal from the current inventory.';

  if (intent === 'quick-meal') return `${formatPlan(plan)}${goalNote(goals)}`;
  if (intent === 'variation') return summarizePlan(plan, 'Here is a different option:');

  if (intent === 'high-protein') {
    if (plan.proteinLevel !== 'high') {
      return `Your current inventory does not appear to contain a strong protein source such as chicken, fish, eggs, tofu, beans, or lentils. The highest-protein option I can make from what is listed is ${plan.title}, mainly using ${plan.ingredients.join(', ')}. Add a stronger protein source for a genuinely high-protein meal.\n\nAsk “How do I make it?” for the steps.`;
    }
    return summarizePlan(plan, 'For a high-protein meal, make');
  }

  if (intent === 'healthy-meal') {
    return `${summarizePlan(plan, 'For a balanced option, make')}${goalNote(goals)}`;
  }

  if (intent === 'expiry-meal') {
    const urgent = urgentNames(usable, 4);
    return `${summarizePlan(plan, 'To use food nearing expiry, make')}\n\nPrioritise ${urgent.join(', ')} because they are the most time-sensitive listed items.`;
  }

  return `${summarizePlan(plan)}${goalNote(goals)}`;
}

module.exports = {
  buildContextualQuestion,
  buildMealPlans,
  classifyFoodIntent,
  cleanHistory,
  fallbackAnswer,
  quickMealPlan: (items) => buildMealPlans(items)[0],
};
