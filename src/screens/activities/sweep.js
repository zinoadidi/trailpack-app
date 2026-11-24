// Mastery sweep: the fact has been learnt, so this round checks it still
// holds. A sweep step is scored hard (right or wrong) on the one format the
// mixer fell back to: multiple choice, fill the blank, true or false or a
// flashcard the learner self rates. Nothing new is introduced and a miss just
// sends the fact back to Review through the session's mastery update.

import { h } from '../../app/ui.js';
import { shell, timer, ctxOf, sweepProgress } from './_helpers.js';
import { clozeMatches } from '../../study/match.js';

/** The format a sweep step renders, from the fact's variants. Pure, tested. */
export function sweepFormat(variant) {
  const type = variant && variant.type;
  return ['multiple-choice', 'cloze', 'true-false', 'flashcard'].includes(type) ? type : 'flashcard';
}

export default function render(container, step, ctx) {
  const { t, onAnswer } = ctxOf(ctx);
  const variant = step.variant || {};
  const format = sweepFormat(variant);
  const clock = timer();
  let answered = false;
  const status = h('div', { class: 'small mut', 'aria-live': 'polite' });
  const progress = sweepProgress(1, 1);
  const body = h('div', { class: 'stack', style: { gap: '10px' } });

  function answer(result) {
    if (answered) return;
    answered = true;
    onAnswer({ ...result, ms: clock.ms() });
  }

  const made = shell(container, t('study.type.sweep'), h('p', { class: 'mut' }, t('study.sweepPrompt')));
  made.head.append(h('span', { class: 'chip v' }, t('act2.sweepBadge', { done: progress.done, total: progress.total })));

  if (format === 'multiple-choice') {
    const choices = Array.isArray(variant.choices) ? variant.choices : [];
    const want = Number(variant.answer);
    const group = h('div', { class: 'stack', role: 'group', 'aria-label': variant.prompt || t('study.type.sweep'), style: { gap: '8px' } });
    choices.forEach((choice, index) => {
      group.append(
        h('button', { type: 'button', class: 'opt', onclick: () => {
          [...group.querySelectorAll('button')].forEach((btn, i) => { btn.disabled = true; if (i === want) btn.classList.add('ok'); else if (i === index) btn.classList.add('no'); });
          status.textContent = index === want ? t('study.correct') : t('study.wrong');
          answer({ correct: index === want, quality: index === want ? 1 : 0, answer: { picked: index } });
        } }, choice),
      );
    });
    body.append(variant.prompt ? h('p', { class: 'mut' }, variant.prompt) : null, group);
  } else if (format === 'cloze') {
    const input = h('input', { class: 'input', type: 'text', 'aria-label': t('study.clozePlaceholder'), placeholder: t('study.clozePlaceholder'), autocomplete: 'off' });
    const check = () => {
      const given = input.value;
      const good = clozeMatches(given, variant.answer || '');
      input.disabled = true;
      status.textContent = good ? t('study.correct') : t('study.wrong') + ' \u2014 ' + (variant.answer || '');
      answer({ correct: good, quality: good ? 1 : 0, answer: { given } });
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
    body.append(h('p', { class: 'mut' }, variant.text || ''), input, h('button', { type: 'button', class: 'btn p block', onclick: check }, t('study.check')));
  } else if (format === 'true-false') {
    const truth = variant.answer === true;
    const pick = (value) => {
      status.textContent = value === truth ? t('study.correct') : t('study.wrong');
      answer({ correct: value === truth, quality: value === truth ? 1 : 0, answer: { picked: value } });
    };
    body.append(
      h('p', { class: 'mut' }, variant.statement || ''),
      h('div', { class: 'row', style: { gap: '8px' } }, h('button', { type: 'button', class: 'btn p block', onclick: () => pick(true) }, t('study.true')), h('button', { type: 'button', class: 'btn block', onclick: () => pick(false) }, t('study.false'))),
    );
  } else {
    // Flashcard: reveal, then rate. A sweep wants a confident recall, so only
    // "Easy" counts as a clean pass here.
    const back = h('p', { style: { display: 'none' } }, variant.back || '');
    const reveal = h('button', { type: 'button', class: 'btn g block', onclick: () => {
      back.style.display = '';
      reveal.style.display = 'none';
      rate.row.style.display = 'flex';
    } }, t('study.showAnswer'));
    const rate = {
      row: h('div', { class: 'row', style: { display: 'none', gap: '8px' } },
        h('button', { type: 'button', class: 'btn block', onclick: () => answer({ selfRate: 'again', correct: false, quality: 0 }) }, t('study.again')),
        h('button', { type: 'button', class: 'btn p block', onclick: () => answer({ selfRate: 'easy', correct: true, quality: 1 }) }, t('study.easy')),
      ),
    };
    body.append(h('p', { class: 'lead' }, variant.front || ''), reveal, back, rate.row);
  }

  made.wrap.insertBefore(body, made.status);
  made.wrap.insertBefore(status, made.status);

  return {
    destroy() {
      answered = true;
    },
  };
}
