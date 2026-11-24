// Listen: the clip is spoken with Web Speech synthesis. Where synthesis is
// missing the transcript is always shown instead, so the step is still
// answerable; the fallback message says why.

import { h } from '../../app/ui.js';
import { shell, timer, ctxOf } from './_helpers.js';
import { speechParams, listenAnswer } from './listen-plan.js';

/** Is speech synthesis usable here? Pure enough to test with a fake global. */
export function speechSupported(win) {
  const w = win || (typeof globalThis !== 'undefined' ? globalThis : null);
  return Boolean(w && w.speechSynthesis && typeof w.SpeechSynthesisUtterance === 'function');
}

/** Pick a voice for the study language, preferring a local one. */
export function pickVoice(voices, lang) {
  const list = Array.isArray(voices) ? voices : [];
  if (!lang) return list[0] || null;
  const code = String(lang).toLowerCase().slice(0, 2);
  const match = list.filter((voice) => String(voice.lang || '').toLowerCase().startsWith(code));
  return match.find((voice) => voice.localService) || match[0] || null;
}

export default function render(container, step, ctx) {
  const { t, onAnswer } = ctxOf(ctx);
  const variant = step.variant || {};
  const choices = Array.isArray(variant.choices) ? variant.choices : [];
  const want = Number(variant.answer);
  const clock = timer();
  const supported = speechSupported();
  let answered = false;
  let played = 0;

  const status = h('div', { class: 'small mut', 'aria-live': 'polite' });
  const transcript = h('p', { class: 'transcript' }, variant.transcript || '');
  const group = h('div', { class: 'stack', role: 'group', 'aria-label': variant.question || t('study.type.listen'), style: { gap: '8px' } });

  function speak() {
    if (!supported) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(variant.transcript || '');
      const voice = pickVoice(window.speechSynthesis.getVoices(), (typeof document !== 'undefined' && document.documentElement.lang) || 'en');
      if (voice) utter.voice = voice;
      const params = speechParams(voice, {});
      utter.rate = params.rate;
      utter.pitch = params.pitch;
      played += 1;
      utter.onstart = () => {
        status.textContent = t('act2.listenPlaying');
      };
      utter.onend = () => {
        if (!answered) status.textContent = t('act2.listenDone');
      };
      utter.onerror = () => {
        if (!answered) status.textContent = t('study.listenUnsupported');
      };
      window.speechSynthesis.speak(utter);
    } catch {
      status.textContent = t('study.listenUnsupported');
    }
  }

  function finish(index) {
    if (answered) return;
    answered = true;
    [...group.querySelectorAll('button')].forEach((btn, i) => {
      btn.disabled = true;
      if (i === want) btn.classList.add('ok');
      else if (i === index) btn.classList.add('no');
    });
    status.textContent = index === want ? t('study.correct') : t('study.wrong');
    onAnswer(listenAnswer(index, want, { heard: supported && played > 0, ms: clock.ms() }));
  }

  choices.forEach((choice, index) => {
    group.append(h('button', { type: 'button', class: 'opt', onclick: () => finish(index) }, choice));
  });

  const controls = h('div', { class: 'row wrap', style: { gap: '8px' } });
  if (supported) {
    controls.append(h('button', { type: 'button', class: 'btn g', 'aria-label': t('study.listenPlay'), onclick: speak }, t('study.listenPlay')));
  } else {
    controls.append(h('p', { class: 'notice warn' }, t('study.listenUnsupported')));
  }

  const made = shell(container, t('study.type.listen'), h('div', {}, controls, variant.question ? h('p', { class: 'mut', style: { marginTop: '8px' } }, variant.question) : null));
  made.wrap.insertBefore(h('div', { class: 'panel', style: { padding: '12px' } }, h('div', { class: 'small mut' }, t('study.listenTranscript')), transcript), made.status);
  made.wrap.insertBefore(group, made.status);
  made.wrap.insertBefore(status, group);

  return {
    destroy() {
      answered = true;
      if (supported) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          /* nothing playing */
        }
      }
    },
    speak,
  };
}
