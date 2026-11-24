// Shared bits for the M4 screens: the profile action wrapper (load, run a pure
// action, save, announce new badges) and the small game widgets used by more
// than one screen. No business rules live here.

import { state, t } from '../app/state.js';
import { h, toast } from '../app/ui.js';
import { loadProfile, saveProfile } from '../game/store.js';
import { levelFor } from '../game/levels.js';

/** Read the profile once per screen mount. */
export async function readProfile() {
  return loadProfile(state.store);
}

/**
 * Run a pure profile action and save the result. `action` takes the current
 * profile and returns `{profile, unlocked?}`. Newly unlocked badges are
 * announced in one calm toast, never one per badge.
 */
export async function runProfileAction(action) {
  const before = await readProfile();
  const result = action(before);
  const profile = result.profile || result;
  await saveProfile(state.store, state.sync, profile);
  const unlocked = result.unlocked || [];
  if (unlocked.length) toast(t('game.achievementsNew', { count: unlocked.length }) + ' \u00b7 ' + unlocked.map((id) => t('game.achievement.' + id)).join(', '));
  return { profile, unlocked };
}

/** Level state for a profile, without a DOM. */
export function levelState(profile, { kind = 'other', factCount = 0 } = {}) {
  return levelFor(profile ? profile.points : 0, { kind, factCount });
}

/** Reduced motion, read live and safely (no matchMedia in node). */
export function prefersReducedMotion() {
  if (typeof matchMedia !== 'function') return false;
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** A progress bar with an accessible label. `pct` is 0 to 100. */
export function progressBar(pct, label) {
  const value = Math.max(0, Math.min(100, Math.round(pct)));
  return h(
    'div',
    { class: 'pbar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(value), 'aria-label': label || t('a11y.progressBar', { percent: value }) },
    h('i', { style: { width: value + '%' } }),
  );
}
