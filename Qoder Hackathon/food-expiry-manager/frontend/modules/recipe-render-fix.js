function removeDuplicateRecipeSummary(root = document) {
  const cards = root.querySelectorAll?.('.assistant-recipe-card') || [];
  for (const card of cards) {
    const summary = card.querySelector('.assistant-recipe-summary');
    if (!summary) continue;

    // Structured recipes legitimately use a short summary above ingredients/steps.
    // Unstructured fallback responses render their complete text in .assistant-rich-text,
    // so showing the parsed summary as well duplicates the same content.
    const hasStructuredRecipe = Boolean(card.querySelector('.assistant-recipe-grid'));
    const hasFullTextFallback = Boolean(card.querySelector(':scope > .assistant-rich-text'));
    if (!hasStructuredRecipe && hasFullTextFallback) summary.remove();
  }
}

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches('.assistant-recipe-card')) removeDuplicateRecipeSummary(node.parentElement || node);
      else if (node.querySelector('.assistant-recipe-card')) removeDuplicateRecipeSummary(node);
    }
  }
});

removeDuplicateRecipeSummary();
observer.observe(document.documentElement, { childList: true, subtree: true });
