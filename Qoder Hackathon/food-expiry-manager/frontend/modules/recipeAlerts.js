// Recipe alerts: one entry per recipe generated on the Ask page, persisted in
// localStorage. The Alerts page renders them and the nav badge counts the
// unread ones. Dependency-free so any module can use it without import cycles.

const RECIPE_ALERTS_KEY = 'fem.recipeAlerts';

/** All stored recipe alerts, oldest first (display sorting happens in alerts.js). */
export function loadRecipeAlerts() {
  try {
    const stored = JSON.parse(localStorage.getItem(RECIPE_ALERTS_KEY));
    if (!Array.isArray(stored)) return [];
    return stored.filter((alert) => alert && typeof alert === 'object' && alert.title);
  } catch {
    return [];
  }
}

function saveRecipeAlerts(alerts) {
  try {
    localStorage.setItem(RECIPE_ALERTS_KEY, JSON.stringify(alerts));
  } catch { /* storage full or unavailable */ }
}

/** Append a new unread alert for a generated recipe. Returns the stored alert. */
export function addRecipeAlert({ title, fullText = '', usesItems = [], ai = false, provider = null }) {
  const alert = {
    id: `recipe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    fullText,
    usesItems,
    ai,
    provider,
    createdAt: new Date().toISOString(),
    read: false,
  };
  const alerts = loadRecipeAlerts();
  alerts.push(alert);
  saveRecipeAlerts(alerts);
  return alert;
}

/** Remove a single recipe alert by id. */
export function deleteRecipeAlert(id) {
  saveRecipeAlerts(loadRecipeAlerts().filter((alert) => alert.id !== id));
}

/** Mark every recipe alert as read (called when the Alerts page is viewed). */
export function markRecipeAlertsRead() {
  const alerts = loadRecipeAlerts();
  let changed = false;
  for (const alert of alerts) {
    if (!alert.read) {
      alert.read = true;
      changed = true;
    }
  }
  if (changed) saveRecipeAlerts(alerts);
}

/** Number of recipe alerts the user has not viewed yet. */
export function unreadRecipeAlertCount() {
  return loadRecipeAlerts().filter((alert) => !alert.read).length;
}
