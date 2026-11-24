// Tone feedback for the listening exercise: which speaker line to say, and
// what to do when the browser has no synthesis. Also the one plan for a
// listen step: read the transcript once, then answer.

/** The rate and pitch a listening clip uses, from the learner's settings. */
export function speechParams(voice, { rate = 0.95, pitch = 1 } = {}) {
  return {
    rate: clamp(rate, 0.5, 1.6, 0.95),
    pitch: clamp(pitch, 0.5, 1.6, 1),
    lang: (voice && voice.lang) || null,
  };
}

/**
 * What to do with a listen step, in order: play, hear it again, then pick.
 * `played` is how many times play was pressed; the screen counts that so the
 * hint can say "listen once more" instead of blocking the answer.
 */
export function listenPlan({ supported, played = 0, answered = false } = {}) {
  if (answered) return { step: 'done', canPlay: false, showTranscript: true };
  if (!supported) return { step: 'read', canPlay: false, showTranscript: true };
  if (!played) return { step: 'play', canPlay: true, showTranscript: true };
  return { step: 'again', canPlay: true, showTranscript: true };
}

/** Save a listen answer: the picked choice and whether the clip was heard. */
export function listenAnswer(picked, want, { heard = true, ms = 0 } = {}) {
  const chosen = Number(picked);
  const right = Number(want);
  const correct = Number.isInteger(chosen) && chosen === right;
  return { correct, quality: correct ? 1 : 0, ms: Math.max(0, Math.round(Number(ms) || 0)), answer: { picked: chosen, answer: right, heard: heard === true } };
}

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
