// Blitz: 60 seconds, as many quick choices as the timer allows. Each pick
// answers the step at once (the session advances); the round's own score is
// shown in the status line. When the clock runs out with nothing picked the
// step answers as a miss, so a bite never stalls on a dead timer.

import { h } from '../../app/ui.js';
import { shell, timer, ctxOf, BLITZ_SECONDS, blitzRemaining, blitzExpired } from './_helpers.js';

export default function render(container, step, ctx) {
  const { t, onAnswer } = ctxOf(ctx);
  const variant = step.variant || {};
  const choices = Array.isArray(variant.choices) ? variant.choices : [];
  const answer = Number(variant.answer);
  const clock = timer();
  const startedAt = Date.now();
  let answered = false;
  let tick = null;

  const timeLine = h('div', { class: 'chip o', role: 'timer', 'aria-live': 'off' }, t('study.blitzTime', { seconds: BLITZ_SECONDS }));
  const status = h('div', { class: 'small mut', 'aria-live': 'polite' });
  const group = h('div', { class: 'stack', role: 'group', 'aria-label': variant.prompt || t('study.type.blitz'), style: { gap: '8px' } });

  function stop() {
    if (tick) clearInterval(tick);
    tick = null;
  }

  function finish(picked) {
    if (answered) return;
    answered = true;
    stop();
    const good = picked === answer;
    [...group.querySelectorAll('button')].forEach((btn, i) => {
      btn.disabled = true;
      if (i === answer) btn.classList.add('ok');
      else if (i === picked) btn.classList.add('no');
    });
    status.textContent = good ? t('study.correct') : t('study.wrong');
    onAnswer({ correct: good, quality: good ? 1 : 0, ms: clock.ms(), answer: { picked, answer, seconds: BLITZ_SECONDS } });
  }

  choices.forEach((choice, index) => {
    group.append(h('button', { type: 'button', class: 'opt', onclick: () => finish(index) }, choice));
  });

  tick = setInterval(() => {
    const left = blitzRemaining(startedAt, Date.now());
    timeLine.textContent = t('study.blitzTime', { seconds: left });
    if (blitzExpired(startedAt, Date.now()) && !answered) finish(-1);
  }, 250);

  const made = shell(container, t('study.type.blitz'), h('div', { class: 'row' }, timeLine));
  if (variant.prompt) made.wrap.insertBefore(h('p', { class: 'mut' }, variant.prompt), made.status);
  made.wrap.insertBefore(group, made.status);
  made.wrap.insertBefore(status, group);

  return {
    destroy() {
      answered = true;
      stop();
    },
  };
}
