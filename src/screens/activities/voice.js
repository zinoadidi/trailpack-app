// Voice answer: Web Speech recognition where the browser has it, an editable
// transcript either way, and an offline coverage check against the variant's
// expected points. Volume stays a self rating (Good or Again), as the session
// treats voice as a self rated activity.

import { h } from '../../app/ui.js';
import { shell, timer, ctxOf } from './_helpers.js';
import { coverage } from '../../study/match.js';

/** Is recognition usable here? */
export function recognitionSupported(win) {
  const w = win || (typeof globalThis !== 'undefined' ? globalThis : null);
  return Boolean(w && (w.SpeechRecognition || w.webkitSpeechRecognition));
}

/**
 * What the coverage line says. Pure, tested: three bands, hit and missed
 * point lists, and the share for the answer row.
 */
export function coverageLine(result) {
  const ratio = result && Number.isFinite(result.ratio) ? result.ratio : 0;
  const band = ratio >= 0.8 ? 'high' : ratio >= 0.5 ? 'mid' : 'low';
  return { band, percent: Math.round(ratio * 100), hit: (result && result.hit) || [], missed: (result && result.missed) || [] };
}

export default function render(container, step, ctx) {
  const { t, onAnswer } = ctxOf(ctx);
  const variant = step.variant || {};
  const points = Array.isArray(variant.points) ? variant.points : [];
  const supported = recognitionSupported();
  const clock = timer();
  let recognition = null;
  let listening = false;
  let answered = false;

  const status = h('div', { class: 'small mut', 'aria-live': 'polite' });
  const input = h('textarea', {
    class: 'input',
    rows: '4',
    'aria-label': t('study.voiceTranscript'),
    placeholder: t('study.voiceEdit'),
    autocomplete: 'off',
  });
  input.value = '';
  const live = h('div', { class: 'small mut', 'aria-live': 'polite' });
  const checkLine = h('div', { class: 'stack', style: { gap: '6px' } });

  function drawCheck() {
    const result = coverage(input.value, points);
    const line = coverageLine(result);
    checkLine.replaceChildren(
      h('div', { class: 'row' }, h('b', {}, t('act2.voiceCoverage', { percent: line.percent })), h('span', { class: 'chip ' + (line.band === 'high' ? 'm' : line.band === 'mid' ? 'a' : 'f') }, t('act2.voiceBand.' + line.band))),
      ...points.map((point) =>
        h(
          'div',
          { class: 'row small', style: { gap: '8px' } },
          h('span', {}, point),
          h('span', { class: line.hit.includes(point) ? 'chip m' : 'chip f' }, line.hit.includes(point) ? t('study.teachPointHit') : t('study.teachPointMissed')),
        ),
      ),
    );
    return result;
  }

  function stop() {
    if (recognition && listening) {
      try {
        recognition.stop();
      } catch {
        /* already stopped */
      }
    }
    listening = false;
    voiceBtn.textContent = t('study.voiceStart');
  }

  function start() {
    if (!supported || listening || answered) return;
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    try {
      recognition = new Ctor();
      recognition.lang = (typeof document !== 'undefined' && document.documentElement.lang) || 'en';
      recognition.interimResults = true;
      recognition.continuous = false;
      const before = input.value.trim();
      recognition.onresult = (event) => {
        let text = '';
        for (let i = 0; i < event.results.length; i += 1) text += ' ' + event.results[i][0].transcript;
        input.value = (before + ' ' + text).trim();
        live.textContent = t('act2.voiceHearing', { text: input.value.slice(-120) });
      };
      recognition.onerror = () => {
        stop();
        status.textContent = t('act2.voiceFailed');
      };
      recognition.onend = () => {
        listening = false;
        voiceBtn.textContent = t('study.voiceStart');
        status.textContent = t('study.voiceEdit');
      };
      recognition.start();
      listening = true;
      voiceBtn.textContent = t('study.voiceStop');
      status.textContent = t('act2.voiceListening');
    } catch {
      status.textContent = t('study.voiceUnsupported');
    }
  }

  function answer(rate) {
    if (answered) return;
    answered = true;
    stop();
    const result = drawCheck();
    onAnswer({ selfRate: rate, correct: rate !== 'again', quality: result.ratio, ms: clock.ms(), transcript: input.value.slice(0, 2000), coverage: result.ratio, answer: { hit: result.hit, missed: result.missed } });
  }

  const voiceBtn = h('button', { type: 'button', class: 'btn g', 'aria-label': t('study.voiceStart'), onclick: () => (listening ? stop() : start()) }, t('study.voiceStart'));
  const made = shell(container, t('study.type.voice'), h('p', { class: 'mut' }, variant.prompt || t('study.voicePrompt')));
  made.wrap.insertBefore(
    h('div', { class: 'row wrap', style: { gap: '8px' } }, supported ? voiceBtn : h('p', { class: 'notice warn' }, t('study.voiceUnsupported'))),
    made.status,
  );
  made.wrap.insertBefore(input, made.status);
  input.addEventListener('input', () => drawCheck());
  made.wrap.insertBefore(live, made.status);
  made.wrap.insertBefore(checkLine, made.status);
  made.wrap.insertBefore(status, made.status);
  made.wrap.append(h('div', { class: 'row', style: { gap: '8px' } }, h('button', { type: 'button', class: 'btn p block', onclick: () => answer('good') }, t('study.good')), h('button', { type: 'button', class: 'btn block', onclick: () => answer('again') }, t('study.again'))));
  drawCheck();

  return {
    destroy() {
      answered = true;
      stop();
      recognition = null;
    },
    get transcript() {
      return input.value;
    },
  };
}
