// Runs one activity across playable facts; progress and attempts use study rules.
import { state, t } from '../app/state.js';
import { announce, h } from '../app/ui.js';
import { saveAttempts, saveProgressMany } from '../study/progress-store.js';
import { currentStep, sessionAttempts } from '../study/session.js';
import { renderActivity } from './activities/index.js';
import { answerPracticeStep, activityStep, practiceLine, startPracticeSession, variantFor } from './practice-run.js';
import { resultSummary } from './practice-result.js';

export function renderPracticeRound(root, { facts, progress, type, onExit }) {
  let session = startPracticeSession({ facts, progress, type });
  let closed = false;
  let locked = false;
  let epoch = 0;
  if (!session) {
    root.replaceChildren(h('section', { class: 'panel stack' }, h('p', {}, t('practice.typeUnavailable')), h('button', { class: 'btn', onclick: onExit }, t('practice.title'))));
    return { destroy() { closed = true; root.replaceChildren(); } };
  }

  function frame(step) {
    const line = practiceLine(type, { index: session.index, total: session.steps.length });
    return h('section', { class: 'panel stack' },
      h('div', { class: 'row wrap' }, h('span', { class: 'chip' }, t(line.label)), h('span', { class: 'mut small' }, t('ship.practiceQuestion', { step: line.index + 1, total: line.total }))),
      h('button', { class: 'btn', type: 'button', onclick: onExit }, t('practice.title')));
  }

  function drawStep() {
    if (closed) return;
    const step = currentStep(session);
    if (!step) return complete();
    const token = ++epoch;
    locked = false;
    const resolved = variantFor(step, facts);
    if (!resolved.variant) return complete();
    const host = h('div', { class: 'panel stack', 'aria-live': 'polite' });
    root.replaceChildren(frame(step), host);
    renderActivity(host, activityStep(step, resolved), {
      t, api: state.api, fact: resolved.fact, variant: resolved.variant, step, index: session.index, total: session.steps.length,
      onAnswer: (payload) => record(payload, token, resolved.variant),
    }).then((result) => {
      if (!closed && token === epoch && result?.fallback) host.append(h('p', { class: 'mut small' }, t('study.fallbackFlash')));
    });
  }

  async function record(payload, token, variant) {
    if (closed || token !== epoch || locked) return;
    locked = true;
    const out = answerPracticeStep(session, payload, facts);
    session = out.session;
    if (out.progressDoc) await saveProgressMany([out.progressDoc]).catch(() => null);
    if (closed || token !== epoch) return;
    announce(t(out.answer?.correct ? 'study.correct' : 'study.wrong'));
    if (out.done) return complete();
    const status = out.answer?.correct ? 'study.correct' : 'study.wrong';
    const next = h('button', { class: 'btn p block', type: 'button', onclick: drawStep }, t('study.next'));
    root.replaceChildren(frame(out.step), h('section', { class: 'panel stack' }, h('b', {}, t(status)), variant.why ? h('p', {}, variant.why) : null, next));
  }

  async function complete() {
    if (closed) return;
    closed = true;
    await saveAttempts(sessionAttempts(session)).catch(() => null);
    const summary = resultSummary(session.answers);
    root.replaceChildren(h('section', { class: 'panel stack', 'data-practice-result': 'true' },
      h('h2', {}, t('ship.practiceComplete')),
      h('p', {}, t('ship.practiceScore', { right: summary.right, wrong: summary.wrong })),
      h('p', {}, t('ship.practiceBest', { count: summary.best })),
      h('p', {}, t('ship.practiceAccuracy', { percent: summary.accuracy })),
      h('button', { class: 'btn p block', type: 'button', onclick: onExit }, t('ship.practiceAgain'))));
  }

  drawStep();
  return { destroy() { closed = true; epoch += 1; root.replaceChildren(); } };
}
