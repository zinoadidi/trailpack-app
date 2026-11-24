// Multiple choice: pick one of the choices. Keys 1 to 4 pick, then show the
// short `why` and let the runner move on.

import { state } from '../../app/state.js';
import { h, announce } from '../../app/ui.js';
import { makeAnswer } from './shared.js';

export default function render(container, step, ctx) {
  const t = ctx.t || state.t;
  const { variant } = ctx;
  const startedAt = Date.now();
  const buttons = [];
  let answered = false;

  function choose(index) {
    if (answered) return;
    answered = true;
    const correct = index === variant.answer;
    buttons.forEach((btn, i) => {
      btn.disabled = true;
      btn.setAttribute('aria-pressed', String(i === index));
      if (i === variant.answer) btn.classList.add('ok');
      if (i === index && !correct) btn.classList.add('bad');
    });
    announce(t(correct ? 'study.correct' : 'study.wrong'));
    ctx.onAnswer(makeAnswer({ correct, variant, fact: ctx.fact, ms: Date.now() - startedAt, answer: variant.choices[index] }));
  }

  const list = h('div', { class: 'stack', style: { gap: '8px' }, role: 'group', 'aria-label': variant.prompt });
  variant.choices.forEach((choice, index) => {
    const btn = h(
      'button',
      { class: 'btn block', type: 'button', style: { justifyContent: 'flex-start', textAlign: 'start' }, onclick: () => choose(index) },
      h('span', { class: 'mut mono', style: { marginRight: '10px' } }, String(index + 1)),
      choice,
    );
    buttons.push(btn);
    list.append(btn);
  });

  container.append(
    h('section', { class: 'panel stack' }, h('p', { class: 'big' }, variant.prompt), list, h('p', { class: 'mut small' }, t('study.choiceKeys'))),
  );

  function onKey(event) {
    const index = Number(event.key) - 1;
    if (Number.isInteger(index) && index >= 0 && index < buttons.length) {
      event.preventDefault();
      choose(index);
    }
  }
  document.addEventListener('keydown', onKey);
  return {
    destroy() {
      document.removeEventListener('keydown', onKey);
    },
  };
}
