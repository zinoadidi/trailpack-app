// Shared answer box for the two writing activities (teach it back, voice
// answer): a textarea with a live coverage line against the variant's
// expected points. Kept apart so both activities stay small and the same
// coverage check can never drift between them.

import { h } from '../../app/ui.js';
import { coverage } from '../../study/match.js';

/** Three bands for a coverage ratio, and the chip class each uses. */
export function coverageBand(ratio) {
  const value = Math.max(0, Math.min(1, Number(ratio) || 0));
  if (value >= 0.8) return { band: 'high', chip: 'm' };
  if (value >= 0.5) return { band: 'mid', chip: 'a' };
  return { band: 'low', chip: 'f' };
}

/** The hit and missed lists, with the same words in both. */
export function pointLines(text, points = []) {
  const result = coverage(text, points);
  return {
    ratio: result.ratio,
    hit: result.hit,
    missed: result.missed,
    rows: (points || []).map((point) => ({ point, hit: result.hit.includes(point) })),
  };
}

/**
 * Build the box. `onChange(result)` runs after every keystroke, so the
 * activity can keep its own copy of the coverage it will answer with.
 */
export function answerBox(t, points, { rows = 4, placeholder = '' } = {}) {
  const input = h('textarea', { class: 'input', rows: String(rows), 'aria-label': placeholder || t('study.teachPrompt'), placeholder, autocomplete: 'off' });
  const line = h('div', { class: 'small mut', 'aria-live': 'polite' });
  return { input, line, draw(text) {
    const result = pointLines(text, points);
    const band = coverageBand(result.ratio);
    line.textContent = t('act2.voiceCoverage', { percent: Math.round(result.ratio * 100) }) + ' \u00b7 ' + t('act2.voiceBand.' + band.band);
    return result;
  } };
}
