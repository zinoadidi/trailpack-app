// Spot the mistake: claims are radio buttons; one is wrong. Picking the wrong
// claim answers at once (right or wrong), so the learner sees why either way.

import { h } from '../../app/ui.js';
import { shell, timer, ctxOf } from './_helpers.js';

/** Where the wrong claim sits, with a safe default. Pure, tested. */
export function wrongIndex(claims, wrong) {
  const list = Array.isArray(claims) ? claims : [];
  const n = Number(wrong);
  if (!list.length) return -1;
  if (Number.isInteger(n) && n >= 0 && n < list.length) return n;
  return list.length - 1;
}

/** Prompt to show: the variant's own, else the fact's statement. */
export function spotPrompt(variant, fact) {
  const own = variant && typeof variant.prompt === 'string' ? variant.prompt.trim() : '';
  if (own) return own;
  return (fact && fact.statement) || '';
}

export default function render(container, step, ctx) {
  const { t, onAnswer } = ctxOf(ctx);
  const variant = step.variant || {};
  const claims = Array.isArray(variant.claims) ? variant.claims : [];
  const target = wrongIndex(claims, variant.wrong);
  const clock = timer();
  let answered = false;
  const status = h('div', { class: 'small mut', 'aria-live': 'polite' });
  const group = h('div', { class: 'stack', role: 'radiogroup', 'aria-label': t('study.spotPrompt'), style: { gap: '8px' } });

  function pick(index) {
    if (answered) return;
    answered = true;
    const picked = [...group.querySelectorAll('button')];
    picked.forEach((btn, i) => {
      btn.disabled = true;
      if (i === target) btn.classList.add('ok');
      else if (i === index) btn.classList.add('no');
    });
    status.textContent = index === target ? t('study.correct') : t('study.wrong');
    const why = variant.why || '';
    if (why) group.append(h('p', { class: 'small mut' }, t('study.why') + ': ' + why));
    onAnswer({ correct: index === target, quality: index === target ? 1 : 0, ms: clock.ms(), answer: { picked: index, wrong: target } });
  }

  claims.forEach((claim, index) => {
    group.append(
      h(
        'button',
        { type: 'button', class: 'opt', role: 'radio', 'aria-checked': 'false', onclick: () => pick(index) },
        h('span', { class: 'ordernum', 'aria-hidden': 'true' }, String(index + 1)),
        h('span', {}, claim),
      ),
    );
  });

  const prompt = spotPrompt(variant, step.fact);
  const made = shell(container, t('study.type.spotMistake'), prompt ? h('p', { class: 'mut' }, prompt) : h('p', { class: 'mut' }, t('study.spotPrompt')));
  made.wrap.insertBefore(group, made.status);
  made.wrap.insertBefore(status, group);

  return {
    destroy() {
      answered = true;
    },
  };
}
