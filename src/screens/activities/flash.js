// Flashcard: read the front, try to recall, flip, then say how it went.
//
// Self rated, so the answer carries `selfRate` ('again' | 'good' | 'easy') and
// the mastery engine decides what that means. Keys: Space or Enter flips,
// 1 / 2 / 3 rate. Swipe left / right on touch also rates.

import { state } from '../../app/state.js';
import { h, announce } from '../../app/ui.js';
import { makeAnswer } from './shared.js';

export default function render(container, step, ctx) {
  const t = ctx.t || state.t;
  const { variant } = ctx;
  const startedAt = Date.now();
  let flipped = false;
  let answered = false;

  const back = h('div', { class: 'stack', hidden: true }, h('p', { class: 'big' }, variant.back));
  const flipBtn = h('button', { class: 'btn p block', type: 'button', onclick: () => flip() }, t('study.showAnswer'));

  function rate(selfRate) {
    if (!flipped || answered) return;
    answered = true;
    const correct = selfRate !== 'again';
    announce(t(correct ? 'study.correct' : 'study.wrong'));
    ctx.onAnswer(makeAnswer({ correct, variant, fact: ctx.fact, ms: Date.now() - startedAt, selfRate, answer: null }));
  }

  function flip() {
    if (flipped) return;
    flipped = true;
    back.hidden = false;
    flipBtn.remove();
    announce(variant.back);
    if (typeof ctx.onFlip === 'function') ctx.onFlip();
    rateRow.hidden = false;
    rateRow.querySelector('button')?.focus();
  }

  const rateRow = h(
    'div',
    { class: 'row wrap', style: { gap: '8px' }, hidden: true, 'aria-label': t('study.feedback') },
    h('button', { class: 'btn', type: 'button', 'aria-label': t('study.again'), onclick: () => rate('again') }, t('study.again')),
    h('button', { class: 'btn', type: 'button', 'aria-label': t('study.good'), onclick: () => rate('good') }, t('study.good')),
    h('button', { class: 'btn g', type: 'button', 'aria-label': t('study.easy'), onclick: () => rate('easy') }, t('study.easy')),
  );

  container.append(
    h(
      'section',
      { class: 'panel stack', 'aria-label': t('study.type.flash') },
      h('p', { class: 'big' }, variant.front),
      back,
      h('p', { class: 'mut small' }, t('study.tapToFlip')),
      flipBtn,
      rateRow,
    ),
  );

  function onKey(event) {
    if (event.key === ' ' || event.key === 'Enter') {
      if (!flipped) {
        event.preventDefault();
        flip();
      }
      return;
    }
    if (!flipped) return;
    const map = { 1: 'again', 2: 'good', 3: 'easy' };
    const choice = map[event.key];
    if (choice) {
      event.preventDefault();
      rate(choice);
    }
  }
  document.addEventListener('keydown', onKey);

  return {
    destroy() {
      document.removeEventListener('keydown', onKey);
    },
  };
}
