// True or false: one claim, two buttons. Keys: T or 1 for true, F or 2 for
// false. The claim may be the fact reworded to be wrong, which is the point.

import { state } from '../../app/state.js';
import { h, announce } from '../../app/ui.js';
import { makeAnswer } from './shared.js';

export default function render(container, step, ctx) {
  const t = ctx.t || state.t;
  const { variant } = ctx;
  const startedAt = Date.now();
  let answered = false;

  const buttons = { true: null, false: null };

  function choose(value) {
    if (answered) return;
    answered = true;
    const correct = value === variant.answer;
    for (const [key, btn] of Object.entries(buttons)) {
      btn.disabled = true;
      btn.setAttribute('aria-pressed', String(key === String(value)));
      if (key === String(variant.answer)) btn.classList.add('ok');
      if (key === String(value) && !correct) btn.classList.add('bad');
    }
    announce(t(correct ? 'study.correct' : 'study.wrong'));
    ctx.onAnswer(makeAnswer({ correct, variant, fact: ctx.fact, ms: Date.now() - startedAt, answer: value }));
  }

  buttons.true = h('button', { class: 'btn block', type: 'button', onclick: () => choose(true) }, t('study.true'));
  buttons.false = h('button', { class: 'btn block', type: 'button', onclick: () => choose(false) }, t('study.false'));

  container.append(
    h(
      'section',
      { class: 'panel stack' },
      h('p', { class: 'big' }, variant.statement),
      h('div', { class: 'row', style: { gap: '10px' }, role: 'group', 'aria-label': variant.statement }, buttons.true, buttons.false),
    ),
  );

  function onKey(event) {
    const key = event.key.toLowerCase();
    if (key === 't' || key === '1' || key === 'arrowright') {
      event.preventDefault();
      choose(true);
    } else if (key === 'f' || key === '2' || key === 'arrowleft') {
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
