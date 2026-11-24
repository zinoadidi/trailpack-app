// Synthesised sound effects (Web Audio, no asset files, works offline).
// Ported from an earlier study app of mine. Sound is OFF until the user turns it on.
// Each sound is a list of notes: [frequency Hz, start s, length s, wave, gain].

const KEY = 'trailpack.sound';

export const SOUNDS = {
  navigate: [[329.63, 0, 0.07, 'sine', 0.06], [440, 0.05, 0.09, 'sine', 0.05]],
  flip: [[392, 0, 0.08, 'triangle', 0.07]],
  correct: [[659.25, 0, 0.1, 'triangle', 0.13], [880, 0.07, 0.14, 'triangle', 0.13]],
  wrong: [[311.13, 0, 0.12, 'sine', 0.1], [261.63, 0.09, 0.16, 'sine', 0.09]],
  stepDone: [[392, 0, 0.12, 'triangle', 0.14], [587.33, 0.1, 0.2, 'triangle', 0.14]],
  biteDone: [[440, 0, 0.1, 'triangle', 0.13], [554.37, 0.09, 0.1, 'triangle', 0.13], [659.25, 0.18, 0.1, 'triangle', 0.13], [880, 0.27, 0.22, 'triangle', 0.13]],
  levelUp: [[440, 0, 0.1, 'triangle', 0.14], [523.25, 0.09, 0.1, 'triangle', 0.14], [659.25, 0.18, 0.1, 'triangle', 0.14], [783.99, 0.27, 0.12, 'triangle', 0.14], [1046.5, 0.38, 0.28, 'triangle', 0.14]],
  achievement: [[523.25, 0, 0.12, 'triangle', 0.14], [659.25, 0.1, 0.12, 'triangle', 0.14], [783.99, 0.2, 0.26, 'triangle', 0.14]],
  failed: [[349.23, 0, 0.14, 'sine', 0.11], [311.13, 0.12, 0.14, 'sine', 0.11], [293.66, 0.24, 0.24, 'sine', 0.1]],
};

export function isSoundOn(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

export function setSoundOn(on, storage = globalThis.localStorage) {
  try {
    storage?.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* storage unavailable: sound stays off */
  }
}

let shared = null;
function sharedContext() {
  if (shared) return shared;
  const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctor) return null;
  shared = new Ctor();
  return shared;
}

// Plays one sound. `ctx` and `storage` can be passed in for tests. Never throws.
export function play(name, { ctx = null, storage = globalThis.localStorage } = {}) {
  const notes = SOUNDS[name];
  if (!notes || !isSoundOn(storage)) return false;
  try {
    const c = ctx || sharedContext();
    if (!c) return false;
    if (c.state === 'suspended') c.resume?.();
    for (const [freq, start, length, wave, gain] of notes) {
      const osc = c.createOscillator();
      const amp = c.createGain();
      const t = c.currentTime + start;
      osc.type = wave;
      osc.frequency.setValueAtTime(freq, t);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(gain, t + 0.025);
      amp.gain.exponentialRampToValueAtTime(0.001, t + length);
      osc.connect(amp);
      amp.connect(c.destination);
      osc.start(t);
      osc.stop(t + length + 0.05);
    }
    return true;
  } catch {
    return false;
  }
}
