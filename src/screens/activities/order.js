// Put in order: a list of cards, each moved with Up and Down buttons or the
// ArrowUp/ArrowDown keys while the card has focus (a real keyboard order, not
// a drag only). Answers on Check with the positions that were right.

import { h } from '../../app/ui.js';
import { shell, shuffle, seedOf, timer, ctxOf, moveItem, reorderKey } from './_helpers.js';

/** How many positions match the wanted order. Pure, tested. */
export function orderScore(given, wanted) {
  const a = Array.isArray(given) ? given : [];
  const b = Array.isArray(wanted) ? wanted : [];
  const total = Math.max(a.length, b.length);
  if (!total) return { right: 0, total: 0, ratio: 0 };
  let right = 0;
  for (let i = 0; i < total; i += 1) if (a[i] !== undefined && a[i] === b[i]) right += 1;
  return { right, total, ratio: right / total };
}

export default function render(container, step, ctx) {
  const { t, onAnswer } = ctxOf(ctx);
  const items = Array.isArray(step.variant && step.variant.items) ? step.variant.items : [];
  const wanted = items.map((text, index) => ({ text, key: 'i' + index }));
  let order = shuffle(wanted, seedOf(step));
  const clock = timer();
  let answered = false;
  const status = h('div', { class: 'small mut', 'aria-live': 'polite' });
  const list = h('ol', { class: 'orderlist', role: 'list', 'aria-label': t('study.orderPrompt') });

  function draw(focusIndex = null) {
    list.replaceChildren(
      ...order.map((item, index) =>
        h(
          'li',
          { class: 'orderitem' },
          h('span', { class: 'ordernum', 'aria-hidden': 'true' }, String(index + 1)),
          h(
            'button',
            {
              type: 'button',
              class: 'ordertext',
              'aria-label': t('act2.orderItemLabel', { position: index + 1, text: item.text }),
              onkeydown: (e) => onKey(e, index),
            },
            item.text,
          ),
          h(
            'span',
            { class: 'orderbtns' },
            h('button', { type: 'button', class: 'btn sm', 'aria-label': t('study.orderUp'), disabled: index === 0, onclick: () => move(index, index - 1, index - 1) }, '\u2191'),
            h('button', { type: 'button', class: 'btn sm', 'aria-label': t('study.orderDown'), disabled: index === order.length - 1, onclick: () => move(index, index + 1, index + 1) }, '\u2193'),
          ),
        ),
      ),
    );
    if (focusIndex !== null) {
      const target = list.children[focusIndex]?.querySelector('.ordertext');
      if (target) target.focus();
    }
  }

  function onKey(e, index) {
    const next = reorderKey(index, e.key, order.length);
    if (next === null) return;
    e.preventDefault();
    move(index, next, next);
  }

  function move(from, to, focusAt) {
    if (answered || from === to) return;
    order = moveItem(order, from, to);
    draw(focusAt);
    status.textContent = t('act2.orderMoved', { position: focusAt + 1 });
  }

  function check() {
    if (answered) return;
    const score = orderScore(order.map((item) => item.text), wanted.map((item) => item.text));
    onAnswer({ correct: score.ratio === 1, quality: score.ratio, ms: clock.ms(), answer: { right: score.right, total: score.total } });
  }

  draw();
  const made = shell(container, t('study.type.order'), h('p', { class: 'mut' }, t('study.orderPrompt')));
  made.wrap.insertBefore(list, made.status);
  made.wrap.insertBefore(status, list);
  made.wrap.append(h('button', { type: 'button', class: 'btn p block', onclick: check }, t('study.check')));

  return {
    destroy() {
      answered = true;
    },
    get order() {
      return order.map((item) => item.text);
    },
  };
}
