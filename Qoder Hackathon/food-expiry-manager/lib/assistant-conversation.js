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

  // The browser stores the current user message before sending the request.
  // Remove that trailing duplicate because the current question is sent separately.
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

  const suffix = `\nCurrent user message: ${current}\nAnswer the current message. Resolve words such as "it", "that", and "the meal" from the recent conversation.`;
  const maxPrefixLength = Math.max(0, 590 - suffix.length);
  const lines = [];
  let used = 'Recent conversation:\n'.length;

  for (let index = clean.length - 1; index >= 0; index -= 1) {
    const entry = clean[index];
    const label = entry.role === 'user' ? 'User' : 'FreshTrack';
    const available = maxPrefixLength - used - label.length - 3;
    if (available < 24) break;
    const text = entry.text.slice(0, Math.min(240, available));
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

function urgentNames(items, limit = 5) {
  return [...usableItems(items)]
    .map((item) => ({ ...item, days: daysUntil(item.expiresAt) }))
    .sort((a, b) => {
      const aDays = a.days === null ? Number.POSITIVE_INFINITY : a.days;
      const bDays = b.days === null ? Number.POSITIVE_INFINITY : b.days;
      return aDays - bDays;
    })
    .slice(0, limit)
    .map((item) => item.name);
}

function findName(items, patterns) {
  return usableItems(items).find((item) => patterns.some((pattern) => pattern.test(String(item.name || ''))))?.name || null;
}

function quickMealPlan(items) {
  const names = urgentNames(items, 6);
  const carrot = findName(items, [/carrot/i]);
  const peas = findName(items, [/pea/i]);
  const cheese = findName(items, [/cheddar/i, /cheese/i]);
  const rice = findName(items, [/rice/i]);
  const bread = findName(items, [/bread/i, /wrap/i, /tortilla/i]);
  const protein = findName(items, [/chicken/i, /beef/i, /pork/i, /tofu/i, /egg/i, /fish/i, /tuna/i]);
  const vegetables = usableItems(items)
    .filter((item) => /vegetable/i.test(String(item.category || '')) || /carrot|pea|lettuce|tomato|spinach|broccoli|pepper|onion|cabbage/i.test(String(item.name || '')))
    .map((item) => item.name)
    .slice(0, 3);

  if (carrot && peas && cheese) {
    return {
      title: `15-minute ${carrot}, ${peas} and ${cheese} skillet`,
      ingredients: [carrot, peas, cheese, ...(rice ? [rice] : [])],
      steps: [
        `Slice the ${carrot} very thinly so it cooks quickly.`,
        `Put the ${carrot} in a covered pan with a small splash of water and cook for about 5 minutes.`,
        `Add the ${peas} and cook for another 3 to 4 minutes, stirring once or twice.`,
        `Lower the heat, add the ${cheese}, cover the pan, and let it melt for 1 to 2 minutes.`,
        rice
          ? `Serve it over warmed ${rice} if the rice is already cooked; uncooked rice will take longer than 15 minutes.`
          : 'Serve immediately while hot.',
      ],
    };
  }

  if (bread && (protein || cheese) && vegetables.length) {
    const filling = [protein, cheese, ...vegetables].filter(Boolean).slice(0, 4);
    return {
      title: `15-minute ${filling.join(', ')} sandwich`,
      ingredients: [bread, ...filling],
      steps: [
        `Prepare the ${filling.join(', ')} and discard anything showing signs of spoilage.`,
        protein ? `Cook or reheat the ${protein} until properly hot and fully cooked.` : 'Slice the filling into bite-sized pieces.',
        `Layer the filling on the ${bread}.`,
        'Toast the assembled sandwich in a dry covered pan for 2 to 3 minutes per side, if preferred.',
        'Serve immediately.',
      ],
    };
  }

  if (rice && (protein || vegetables.length)) {
    const additions = [protein, ...vegetables].filter(Boolean).slice(0, 4);
    return {
      title: `Quick ${additions.join(' and ')} rice bowl`,
      ingredients: [rice, ...additions],
      steps: [
        `Use already-cooked ${rice}; uncooked rice usually will not be ready within 15 minutes.`,
        protein ? `Cook or reheat the ${protein} thoroughly.` : `Cut the ${additions[0]} into small pieces.`,
        `Cook the ${additions.filter((name) => name !== protein).join(', ') || 'remaining ingredients'} until tender and hot.`,
        `Combine everything with the warmed ${rice}.`,
        'Serve immediately after checking the food for spoilage.',
      ],
    };
  }

  const selected = names.slice(0, 4);
  return {
    title: `Quick pantry skillet with ${selected.join(', ') || 'your available food'}`,
    ingredients: selected,
    steps: [
      `Cut ${selected.join(', ') || 'the available ingredients'} into small, even pieces.`,
      'Start with the firmest ingredient and cook it in a covered pan with a splash of water.',
      'Add the remaining ingredients in order of how quickly they cook.',
      'Cook until everything that requires cooking is properly hot and done.',
      'Serve immediately and discard anything with signs of spoilage.',
    ],
  };
}

function formatPlan(plan, intro = '') {
  const ingredients = plan.ingredients.length ? `\n\nIngredients from your inventory: ${plan.ingredients.join(', ')}.` : '';
  const steps = plan.steps.map((step, index) => `${index + 1}. ${step}`).join('\n');
  return `${intro ? `${intro}\n\n` : ''}${plan.title}${ingredients}\n\n${steps}`;
}

function isHowToFollowUp(question) {
  const lower = String(question || '').trim().toLowerCase();
  return /^(how|how do|how to|show me|tell me how|steps|instructions|method)\b/.test(lower)
    || /\b(how (?:do|can|should) i (?:make|cook|prepare)|how to (?:make|cook|prepare)|what are the steps|give me the steps|do it|make it|cook it)\b/.test(lower);
}

function isIngredientFollowUp(question) {
  return /\b(what ingredients|ingredients do i need|what do i need|which ingredients)\b/i.test(String(question || ''));
}

function isTimingFollowUp(question) {
  return /\b(how long|cooking time|cook time|minutes|timing)\b/i.test(String(question || ''));
}

function isReplacementFollowUp(question) {
  return /\b(replace|substitute|swap|instead of)\b/i.test(String(question || ''));
}

function lastAssistantText(history) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].role === 'assistant') return history[index].text;
  }
  return '';
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

  const lower = String(question || '').toLowerCase();
  const previous = lastAssistantText(clean);
  const referential = /\b(it|that|the meal|the recipe|your suggestion)\b/i.test(question);
  const followUp = isHowToFollowUp(question)
    || isIngredientFollowUp(question)
    || isReplacementFollowUp(question)
    || referential
    || (Boolean(previous) && isTimingFollowUp(question));

  if (followUp && !previous) {
    return 'I do not have a previous meal in this conversation to refer to. Name the meal or choose one of the quick prompts, and I will give you exact steps.';
  }

  if (followUp) {
    const plan = quickMealPlan(usable);
    if (isIngredientFollowUp(question)) {
      return `For the meal I just suggested, use: ${plan.ingredients.join(', ')}. Use only items that still look and smell normal, and do not rely on the date alone.`;
    }
    if (isReplacementFollowUp(question)) {
      const available = urgentNames(usable, 6).join(', ');
      return `I can only suggest swaps from your current inventory. Available options are ${available}. Tell me which ingredient you want to replace, and I will choose the closest match.`;
    }
    if (isTimingFollowUp(question)) {
      return formatPlan(plan, 'Here is the timed version of the meal I just suggested:');
    }
    return formatPlan(plan, 'Here is how to make the meal I just suggested:');
  }

  if (/15\s*-?\s*minute|quick|fast/i.test(lower)) {
    return `${formatPlan(quickMealPlan(usable))}${goalNote(goals)}`;
  }

  const names = urgentNames(usable, 5);
  if (lower.includes('healthy')) {
    const plan = quickMealPlan(usable);
    return `A practical healthier option is ${plan.title}. Use moderate portions of richer ingredients and make vegetables the largest part of the meal.${goalNote(goals)}\n\nAsk “How do I make it?” and I will give the steps.`;
  }
  if (lower.includes('first') || lower.includes('waste') || lower.includes('expire')) {
    return `Use ${names.join(', ')} first because they are the most time-sensitive items in your inventory. Plan one meal around them today and freeze anything you cannot use safely.`;
  }

  const plan = quickMealPlan(usable);
  return `A concrete option is ${plan.title}. It uses ${plan.ingredients.join(', ')} from your inventory.${goalNote(goals)}\n\nAsk “How do I make it?” for the exact steps.`;
}

module.exports = {
  buildContextualQuestion,
  cleanHistory,
  fallbackAnswer,
  quickMealPlan,
};
