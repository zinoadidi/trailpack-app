// What the Trail home does when a pack has no plan yet: it says so and
// offers the two ways forward (add a document, or open the mixer). A pack
// with facts but no camps gets a one line explanation rather than a blank
// path. Pure, so the screen and the test agree on which case is which.

/**
 * Which empty state the home shows.
 * @param {number} packCount  how many packs the device has
 * @param {object|null} plan  the normalised plan, if any
 * @param {number} factCount  facts in the active pack
 */
export function emptyHome(packCount, plan, factCount) {
  const camps = plan && Array.isArray(plan.camps) ? plan.camps.length : 0;
  if (packCount === 0) return { kind: 'no-pack', cta: 'library', message: 'trail.empty' };
  if (!factCount) return { kind: 'empty-pack', cta: 'library', message: 'trail.empty' };
  if (!camps) return { kind: 'no-camps', cta: 'library', message: 'trail.empty' };
  return { kind: 'ready', cta: null, message: null };
}

/** Does the home need the empty state at all? */
export function needsEmptyState(packCount, plan, factCount) {
  return emptyHome(packCount, plan, factCount).kind !== 'ready';
}

/** The link the empty state's main button points at. */
export function ctaHref(kind) {
  return kind === 'no-pack' || kind === 'empty-pack' || kind === 'no-camps' ? '#/library' : '#/';
}
