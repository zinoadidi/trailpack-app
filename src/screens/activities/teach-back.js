// Teach it back: the learner explains the fact in their own words. An offline
// keyword coverage check runs at once; when online the same answer is sent to
// `/llm/chat` with task `teach` and the reply's coverage and missed facts are
// added on top. The offline check never blocks: if the model is slow or down
// the answer can still be rated.

import { h } from '../../app/ui.js';
import { shell, timer, ctxOf } from './_helpers.js';
import { coverage } from '../../study/match.js';
import { teachMessages, readScoreReply } from '../../study/prompts.js';

/** The one sentence to show under the box, from coverage and any reply. */
export function teachFeedback(offline, reply) {
  const score = reply && Number.isFinite(reply.score) ? Math.max(reply.score, offline.ratio) : offline.ratio;
  const missed = [...new Set([...(reply && reply.missed ? reply.missed : []), ...offline.missed])];
  return {
    percent: Math.round(score * 100),
    score,
    missed,
    comment: (reply && reply.comment) || '',
    band: score >= 0.8 ? 'high' : score >= 0.5 ? 'mid' : 'low',
  };
}

export default function render(container, step, ctx) {
  const { t, onAnswer } = ctxOf(ctx);
  const variant = step.variant || {};
  const points = Array.isArray(variant.points) ? variant.points : [];
  const clock = timer();
  let answered = false;
  let reply = null;

  const status = h('div', { class: 'small mut', 'aria-live': 'polite' });
  const input = h('textarea', { class: 'input', rows: '5', 'aria-label': t('study.teachPrompt'), placeholder: t('study.teachPlaceholder'), autocomplete: 'off' });
  const checkLine = h('div', { class: 'stack', style: { gap: '6px' } });

  function draw(lines) {
    const feedback = teachFeedback(lines, reply);
    checkLine.replaceChildren(
      h('div', { class: 'row' }, h('b', {}, t('act2.teachCoverage', { percent: feedback.percent })), h('span', { class: 'chip ' + (feedback.band === 'high' ? 'm' : feedback.band === 'mid' ? 'a' : 'f') }, t('act2.voiceBand.' + feedback.band))),
      ...points.map((point) =>
        h('div', { class: 'row small', style: { gap: '8px' } }, h('span', {}, point), h('span', { class: feedback.missed.includes(point) ? 'chip f' : 'chip m' }, feedback.missed.includes(point) ? t('study.teachPointMissed') : t('study.teachPointHit'))),
      ),
      feedback.comment ? h('p', { class: 'small' }, feedback.comment) : null,
    );
    return feedback;
  }

  async function askModel(lines) {
    const api = (ctx && ctx.api) || null;
    if (!api || typeof api.chat !== 'function' || !lines.trim()) return;
    status.textContent = t('act2.teachAsking');
    try {
      const messages = teachMessages({ topic: variant.prompt || '', facts: points.map((p, i) => ({ id: 'p' + i, statement: p })), answer: lines.slice(0, 2000) });
      const res = await api.chat({ task: 'teach', messages, json: true, maxTokens: 400 });
      if (answered) return;
      reply = readScoreReply(res && res.text ? safeJson(res.text) : res);
      status.textContent = t('act2.teachScored');
      draw(lines);
    } catch (err) {
      if (answered) return;
      status.textContent = t('act2.teachOffline', { note: (err && err.code) || 'error' });
    }
  }

  function submit() {
    if (answered) return;
    answered = true;
    const lines = input.value.trim();
    const offline = coverage(lines, points);
    const feedback = draw(offline);
    onAnswer({ correct: null, selfRate: feedback.score >= 0.5 ? 'good' : 'again', quality: feedback.score, score: feedback.score, ms: clock.ms(), transcript: lines.slice(0, 2000), coverage: offline.ratio, answer: { hit: offline.hit, missed: offline.missed } });
  }

  input.addEventListener('input', () => draw(input.value));
  input.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
  });

  const made = shell(container, t('study.type.teachBack'), h('p', { class: 'mut' }, variant.prompt || t('study.teachPrompt')));
  made.wrap.insertBefore(input, made.status);
  made.wrap.insertBefore(checkLine, made.status);
  made.wrap.insertBefore(status, made.status);
  made.wrap.append(
    h('div', { class: 'row', style: { gap: '8px' } }, h('button', { type: 'button', class: 'btn g', onclick: () => askModel(input.value) }, t('act2.teachCheck')), h('button', { type: 'button', class: 'btn p block', onclick: submit }, t('study.check'))),
  );
  draw('');

  return {
    destroy() {
      answered = true;
    },
    get reply() {
      return reply;
    },
  };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
