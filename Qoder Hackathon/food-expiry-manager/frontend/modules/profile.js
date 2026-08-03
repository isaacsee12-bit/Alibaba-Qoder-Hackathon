// Profile settings: nutrition goals/requirements, persisted in localStorage.
// Used by the Settings page; the same helpers can be reused by other views
// (e.g. to tailor meal suggestions) without touching this module's internals.

const NUTRITION_GOALS_KEY = 'fem.nutritionGoals';
const NUTRITION_GOALS = ['High Protein', 'Low Sugar', 'Low Sodium', 'Low Fat'];

/** Read the saved nutrition goals; only known presets are returned. */
export function loadNutritionGoals() {
  try {
    const stored = JSON.parse(localStorage.getItem(NUTRITION_GOALS_KEY));
    if (!Array.isArray(stored)) return [];
    return NUTRITION_GOALS.filter((goal) => stored.includes(goal));
  } catch {
    return [];
  }
}

/** Persist the selected nutrition goals; only known presets are stored. */
export function saveNutritionGoals(goals) {
  const valid = NUTRITION_GOALS.filter((goal) => goals.includes(goal));
  try {
    localStorage.setItem(NUTRITION_GOALS_KEY, JSON.stringify(valid));
  } catch { /* storage full or unavailable */ }
  return valid;
}

/** Markup for the Profile section: a card with selectable nutrition goal chips. */
export function profileMarkup() {
  const selected = loadNutritionGoals();
  const chips = NUTRITION_GOALS.map((goal) => {
    const active = selected.includes(goal);
    return `<button type="button" class="goal-chip${active ? ' active' : ''}" data-goal="${goal}" aria-pressed="${active}">${goal}</button>`;
  }).join('');
  return `
    <h3>Profile</h3>
    <div class="card">
      <p class="card-title">Nutrition Goals / Requirements</p>
      <p class="card-sub">Select the nutrition goals you want your meal suggestions to follow. Multiple goals can be active at once, and your choices are saved on this device.</p>
      <div class="profile-goals" role="group" aria-label="Nutrition goals">${chips}</div>
      <p class="card-sub" id="profile-goals-status" aria-live="polite"></p>
    </div>
  `;
}

/** Wire the goal chips: toggle selection and persist it immediately. */
export function bindProfile(view) {
  const status = view.querySelector('#profile-goals-status');
  const chips = view.querySelectorAll('.goal-chip');

  const update = () => {
    const selected = [...chips]
      .filter((chip) => chip.classList.contains('active'))
      .map((chip) => chip.dataset.goal);
    saveNutritionGoals(selected);
    if (status) {
      status.textContent = selected.length
        ? `Goals saved: ${selected.join(', ')}.`
        : 'No goals selected.';
    }
  };

  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const active = chip.classList.toggle('active');
      chip.setAttribute('aria-pressed', String(active));
      update();
    });
  });

  update();
}
