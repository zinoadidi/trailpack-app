// Fill the blank: the sentence with a gap, answered by typing the word or by
// tapping words from the bank in order. Enter checks, Escape clears back to
// typing. The comparison is forgiving about case, accents and typos (shared
// `matchesTyped`), because this is recall, not spelling.

import { state } from '../../app/state.js';
import { h, announce } from '../../app/ui.js';
import { makeAnswer, matchesTyped } from './shared.js';

function shuffled(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export default function render(container, step, ctx) {
  const t = ctx.t || state.t;
  const { variant } = ctx;
  const startedAt = Date.now();
  const expected = String(variant.answer || '');
  const bank = Array.isArray(variant.bank) && variant.bank.length ? variant.bank : expected.split(' ').filter(Boolean);
  const wordy = expected.split(' ').filter(Boolean).length > 1;
  const canTap = wordy || bank.length > 1;
  let tapped = [];
  let answered = false;
  let mode = 'type';

  const input = h('input', { class: 'input', type: 'text', id: 'cloze-in', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': t('study.clozePlaceholder'), placeholder: t('study.clozePlaceholder') });
  const slot = h('span', { class: 'chip v', 'aria-live': 'off' }, t('study.blankHere'));
  const bankEl = h('div', { class: 'row wrap', style: { gap: '8px' } });
  const check = h('button', { class: 'btn p block', type: 'button', onclick: () => submit() }, t('study.check'));
  const changeMode = canTap
    ? h('button', { class: 'btn sm', type: 'button', onclick: () => setMode(mode === 'type' ? 'tap' : 'type') }, t('study.tapInstead'))
    : null;

  function setMode(next) {
    mode = next;
    tapped = [];
    input.hidden = mode !== 'type';
    bankEl.hidden = mode !== 'tap';
    if (changeMode) changeMode.textContent = mode === 'type' ? t('study.tapInstead') : t('study.typeInstead');
    paintSlot();
    if (mode === 'type') input.focus();
    else bankEl.querySelector('button')?.focus();
  }

  function paintSlot() {
    slot.textContent = tapped.length ? tapped.join(' ') : t('study.blankHere');
  }

  function drawBank() {
    bankEl.replaceChildren(
      ...shuffled(bank).map((word) =>
        h('button', { class: 'btn sm', type: 'button', onclick: (event) => tap(word, event.currentTarget) }, word),
      ),
    );
  }

  function tap(word, btn) {
    if (answered || (!wordy && tapped.length >= 1)) return;
    if (btn.dataset.used) return;
    btn.dataset.used = '1';
    btn.disabled = true;
    tapped = [...tapped, word];
    paintSlot();
    if (tapped.length >= Math.max(1, expected.split(' ').length)) submit();
  }

  function submit() {
    if (answered) return;
    const given = mode === 'tap' ? tapped.join(' ') : input.value;
    if (!String(given).trim()) {
      input.focus();
      return;
    }
    answered = true;
    const correct = matchesTyped(given, expected);
    input.disabled = true;
    check.disabled = true;
    slot.textContent = correct ? turned(given) : turned(expected);
    slot.className = 'chip ' + (correct ? 'm' : 'e');
    bankEl.querySelectorAll('button').forEach((btn) => {
      btn.disabled = true;
    });
    announce(t(correct ? 'study.correct' : 'study.wrong'));
    ctx.onAnswer(makeAnswer({ correct, variant, fact: ctx.fact, ms: Date.now() - startedAt, answer: String(given).slice(0, 200) }));
  }

  /** The sentence with the blank filled, so the learner sees it read back. */
  function turned(word) {
    return String(variant.text).replace('___', word);
  }

  const parts = String(variant.text).split('___');
  const setParts = [h('span', {}, parts[0] || ''), slot, h('span', {}, parts.slice(1).join('___'))];

  container.append(
    h(
      'section',
      { class: 'panel stack', 'aria-label': t('study.type.cloze') },
      h('p', { class: 'big' }, ...setParts),
      canTap ? h('p', { class: 'mut small' }, mode === 'tap' ? t('study.tapWords') : t('study.clozePlaceholder')) : null,
      input,
      h('div', { class: 'stack', style: { gap: '6px' }, hidden: true }, h('p', { class: 'mut small' }, t('study.wordBank')), bankEl),
      h('div', { class: 'row wrap', style: { gap: '8px' } }, check, changeMode),
    ),
  );
  bankEl.hidden = true;
  input.focus();

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  });

  return {
    destroy() {},
  };
}
