// Swipe quiz: a claim, dragged right for true or left for false. The drag is
// decoration: the two buttons and the arrow keys always work, so a phone, a
// keyboard and a screen reader all get the same activity. Reduced motion gets
// no tilt and no slide, just the card and the buttons.

import { state } from '../../app/state.js';
import { h, announce } from '../../app/ui.js';
import { makeAnswer } from './shared.js';

const THRESHOLD = 70;

export default function render(container, step, ctx) {
  const t = ctx.t || state.t;
  const { variant } = ctx;
  const startedAt = Date.now();
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let answered = false;
  let dx = 0;
  let startX = null;

  const card = h('div', { class: 'panel swipeCard', style: { touchAction: 'pan-y' } }, h('p', { class: 'big' }, variant.statement));

  function reset() {
    dx = 0;
    card.style.transform = '';
    card.style.borderColor = '';
  }

  function choose(value) {
    if (answered) return;
    answered = true;
    const correct = value === variant.answer;
    const ok = correct ? 'var(--mint)' : 'var(--error)';
    card.style.borderColor = ok;
    if (!reduced) card.style.transform = `translateX(${value ? 60 : -60}px)`;
    announce(t(correct ? 'study.correct' : 'study.wrong'));
    ctx.onAnswer(makeAnswer({ correct, variant, fact: ctx.fact, ms: Date.now() - startedAt, answer: value }));
  }

  card.addEventListener('pointerdown', (event) => {
    if (answered) return;
    startX = event.clientX;
    card.setPointerCapture?.(event.pointerId);
  });
  card.addEventListener('pointermove', (event) => {
    if (startX === null || answered) return;
    dx = event.clientX - startX;
    if (reduced) return;
    const tilt = Math.max(-10, Math.min(10, dx / 12));
    card.style.transform = `translateX(${Math.max(-120, Math.min(120, dx))}px) rotate(${tilt}deg)`;
  });
  const release = () => {
    if (startX === null) return;
    startX = null;
    if (answered) return;
    if (dx >= THRESHOLD) choose(true);
    else if (dx <= -THRESHOLD) choose(false);
    else reset();
  };
  card.addEventListener('pointerup', release);
  card.addEventListener('pointercancel', release);

  container.append(
    h(
      'section',
      { class: 'stack' },
      card,
      h('p', { class: 'mut small' }, t('study.swipeHint') + ' · ' + t('study.swipeByKeyboard')),
      h(
        'div',
        { class: 'row', style: { gap: '10px' }, role: 'group', 'aria-label': variant.statement },
        h('button', { class: 'btn block', type: 'button', onclick: () => choose(false) }, '← ' + t('study.swipeLeft')),
        h('button', { class: 'btn block p', type: 'button', onclick: () => choose(true) }, t('study.swipeRight') + ' →'),
      ),
    ),
  );

  function onKey(event) {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      choose(true);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      choose(false);
    }
  }
  document.addEventListener('keydown', onKey);
  return {
    destroy() {
      document.removeEventListener('keydown', onKey);
    },
  };
}
