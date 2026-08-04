const {
  cleanHistory,
  fallbackAnswer: inventoryFallbackAnswer,
} = require('./assistant-conversation');

function normalizedQuestion(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function isGreeting(value) {
  return /^(?:hi|hello|hey|hiya|yo|good\s+(?:morning|afternoon|evening)|what(?:'s| is)\s+up|sup)[!?.\s]*$/i.test(value);
}

function isThanks(value) {
  return /^(?:thanks|thank\s+you|thank\s+u|thx|ty|cheers)(?:\s+(?:a\s+lot|so\s+much))?[!?.\s]*$/i.test(value);
}

function isFarewell(value) {
  return /^(?:bye|goodbye|see\s+you|see\s+ya|later|good\s*night)[!?.\s]*$/i.test(value);
}

function isHowAreYou(value) {
  return /^(?:how\s+are\s+you|how(?:'s| is)\s+it\s+going|you\s+good)[!?.\s]*$/i.test(value);
}

function isHelpRequest(value) {
  return /^(?:help|help\s+me|what\s+can\s+you\s+do|how\s+can\s+you\s+help|what\s+do\s+you\s+do)[!?.\s]*$/i.test(value);
}

function isAcknowledgement(value) {
  return /^(?:ok(?:ay)?|alright|sure|got\s+it|understood|yes|yep|yeah|no|nope)[!?.\s]*$/i.test(value);
}

function hasFoodIntent(value) {
  return /\b(?:food|meal|recipe|cook|cooking|make|prepare|eat|eating|ingredient|inventory|pantry|breakfast|lunch|dinner|snack|dish|expiry|expire|expired|waste|healthy|protein|vegetarian|vegan|spicy|sweet|quick|minute|leftover|freeze|fridge|substitute|replace|swap|serve)\b/i.test(value);
}

function isContextualFollowUp(value, history) {
  if (!history.length) return false;
  return /\b(?:it|that|this|the\s+meal|the\s+recipe|your\s+suggestion|those|them)\b/i.test(value)
    || /\b(?:how|why|when|where|steps?|instructions?|method|ingredients?|quantit(?:y|ies)|how\s+long|temperature|replace|substitute|swap|instead)\b/i.test(value);
}

function hasAssistantTurn(history) {
  return history.some((entry) => entry.role === 'assistant');
}

function conversationalFallbackAnswer(question, items, goals = [], history = []) {
  const current = normalizedQuestion(question);
  const clean = cleanHistory(history, current);

  if (isGreeting(current)) {
    return 'Hi. I’m FreshTrack. Ask me what you can cook, how to use an ingredient, or which food to eat first.';
  }

  if (isHowAreYou(current)) {
    return 'I’m ready to help with your FreshTrack inventory. What are you thinking of cooking?';
  }

  if (isThanks(current)) {
    return 'You’re welcome. Ask another question whenever you need help using your food.';
  }

  if (isFarewell(current)) {
    return 'Goodbye. Remember to check food for signs of spoilage before using it.';
  }

  if (isHelpRequest(current)) {
    return 'I can suggest meals from your inventory, prioritise food nearing expiry, give cooking steps, suggest ingredient swaps, and help reduce waste.';
  }

  if (isAcknowledgement(current)) {
    if (hasAssistantTurn(clean)) {
      return 'Understood. You can ask for the exact steps, cooking time, ingredients, or a different meal.';
    }
    return 'Understood. What would you like help with in your food inventory?';
  }

  if (!hasFoodIntent(current) && !isContextualFollowUp(current, clean)) {
    return 'I’m focused on your FreshTrack food inventory. Ask me about a meal, an ingredient, food nearing expiry, or how to cook a previous suggestion.';
  }

  return inventoryFallbackAnswer(current, items, goals, clean);
}

module.exports = {
  conversationalFallbackAnswer,
  hasFoodIntent,
  isGreeting,
};
