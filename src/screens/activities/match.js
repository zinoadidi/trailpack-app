// Match pairs: tap a term, then its meaning. Every tile is a button, so the
// same two taps work with Enter and Space and Tab moves between tiles.
// Answers once, when every pair is matched: `correct` is true only when no
// pair was mismatched, `quality` is the share of pairs matched.

import { h } from '../../app/ui.js';
import { shell, shuffle, seedOf, timer, ctxOf } from './_helpers.js';

export default function render(container, step, ctx) {
  const { t, onAnswer } = ctxOf(ctx);
  const pairs = Array.isArray(step.variant && step.variant.pairs) ? step.variant.pairs : [];
  const clock = timer();
  let picked = null;
  let clean = true;
  let matched = 0;
  let answered = false;
  const status = h('div', { class: 'small mut', 'aria-live': 'polite' });

  const left = shuffle(pairs.map((p, i) => ({ text: p.term, pair: i })), seedOf(step));
  const right = shuffle(pairs.map((p, i) => ({ text: p.meaning, pair: i })), seedOf(step) + 3);
  const grid = h('div', { class: 'grid-2', role: 'group', 'aria-label': t('study.matchPrompt') });

  function paint(btn, cls) {
    btn.classList.remove('sel', 'ok', 'no');
    if (cls) btn.classList.add(cls);
  }

  function tap(item, side, btn) {
    if (answered) return;
    if (picked && picked.side === side) {
      paint(picked.btn);
      picked.btn.setAttribute('aria-pressed', 'false');
      picked = null;
      return;
    }
    if (!picked) {
      picked = { item, side, btn };
      paint(btn, 'sel');
      btn.setAttribute('aria-pressed', 'true');
      status.textContent = t('act2.matchPicked');
      return;
    }
    const other = picked;
    picked = null;
    other.btn.setAttribute('aria-pressed', 'false');
    if (other.item.pair === item.pair) {
      matched += 1;
      paint(other.btn, 'ok');
      paint(btn, 'ok');
      other.btn.disabled = true;
      btn.disabled = true;
      status.textContent = t('act2.matchRight');
      if (matched === pairs.length) finish();
      return;
    }
    clean = false;
    paint(other.btn, 'no');
    paint(btn, 'no');
    status.textContent = t('act2.matchWrong');
    setTimeout(() => {
      if (!answered) {
        paint(other.btn);
        paint(btn);
      }
    }, 700);
  }

  function tile(item, side) {
    return h(
      'button',
      { type: 'button', class: 'tile', 'aria-pressed': 'false', onclick: (e) => tap(item, side, e.currentTarget) },
      item.text,
    );
  }

  function finish() {
    answered = true;
    onAnswer({ correct: clean, quality: pairs.length ? matched / pairs.length : 0, ms: clock.ms(), answer: { matched, total: pairs.length } });
  }

  for (const item of left) grid.append(tile(item, 'left'));
  for (const item of right) grid.append(tile(item, 'right'));

  const made = shell(container, t('study.type.match'), h('p', { class: 'mut' }, t('study.matchPrompt')));
  made.wrap.insertBefore(grid, made.status);
  made.wrap.insertBefore(status, grid);

  return {
    destroy() {
      answered = true;
    },
  };
}
