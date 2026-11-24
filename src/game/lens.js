// Lens (design 3.5): a small saved instruction set that sits between the Pack
// and what you study. The Pack never changes. A prompt bar turns plain words
// into a Lens diff, the app shows it for approval, and only generated items
// that depend on a changed field are marked stale and regenerated.
//
// Pure: no DOM, no network. `parseLensDiff` reads an LLM or rule based reply,
// `applyDiff` returns the new Lens plus the fields that changed, and
// `staleItems` + `regenerationPlan` do the dependency tracking (design 6.3).
// See ./README.md for the input shapes.

/** Every Lens field a diff may touch. `title` and `id` are never generated. */
export const LENS_FIELDS = ['audience', 'tone', 'formats', 'difficulty', 'length', 'emphasis', 'language', 'extra'];

export const DIFFICULTIES = ['easy', 'medium', 'hard'];

/** Pronounced activity a Lens `formats` map can weight. */
export const LENS_FORMATS = ['flash', 'quiz', 'oral', 'task', 'match', 'order', 'swipe', 'teach', 'listen'];

export function emptyLens(overrides = {}) {
  return {
    id: 'default',
    title: 'Default',
    audience: '',
    tone: '',
    formats: { flash: 0.4, quiz: 0.4, oral: 0.1, task: 0.1 },
    difficulty: 'medium',
    length: { learn_card_words: 80, flash_back_words: 30 },
    emphasis: [],
    language: null,
    extra: '',
    ...overrides,
  };
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function words(value, fallback = 0) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(600, n) : fallback;
}

function list(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((v) => v.trim()).filter(Boolean);
  return [];
}

/**
 * Make a Lens-shaped object safe: unknown formats dropped, weights normalised
 * to sum 1 (empty map is left empty so the caller can fall back), difficulty
 * to one of three, lengths positive.
 */
export function normaliseLens(input = {}) {
  const base = emptyLens();
  const lens = { ...base, ...(input || {}) };
  const formats = {};
  for (const key of LENS_FORMATS) {
    if (lens.formats && lens.formats[key] !== undefined) formats[key] = Math.round(clamp01(lens.formats[key]) * 100) / 100;
  }
  const sum = Object.values(formats).reduce((a, b) => a + b, 0);
  if (sum > 0) for (const key of Object.keys(formats)) formats[key] = Math.round((formats[key] / sum) * 100) / 100;
  return {
    id: String(lens.id || 'default').slice(0, 64),
    title: String(lens.title || 'Default').slice(0, 80),
    audience: String(lens.audience || '').slice(0, 200),
    tone: String(lens.tone || '').slice(0, 200),
    formats: sum > 0 ? formats : {},
    difficulty: DIFFICULTIES.includes(lens.difficulty) ? lens.difficulty : 'medium',
    length: {
      learn_card_words: words(lens.length?.learn_card_words, base.length.learn_card_words),
      flash_back_words: words(lens.length?.flash_back_words, base.length.flash_back_words),
    },
    emphasis: list(lens.emphasis).slice(0, 8),
    language: lens.language ? String(lens.language).slice(0, 20) : null,
    extra: String(lens.extra || '').slice(0, 400),
  };
}

/** Human readable old and new value for one field, for the approval sheet. */
function label(field, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'formats' && typeof value === 'object') {
    return Object.entries(value)
      .filter(([, v]) => Number(v) > 0)
      .map(([k, v]) => k + ' ' + Math.round(Number(v) * 100) + '%')
      .join(', ');
  }
  if (Array.isArray(value)) return value.join(', ');
  if (field === 'length' && typeof value === 'object') return `${value.learn_card_words} / ${value.flash_back_words} words`;
  return String(value);
}

/**
 * Fields that differ between two Lenses, in LENS_FIELDS order. `formats` counts
 * as changed when any weight moved by 0.01 or more, so rounding never nags.
 */
export function changedFields(before, after) {
  const a = normaliseLens(before);
  const b = normaliseLens(after);
  const out = [];
  for (const field of LENS_FIELDS) {
    if (field === 'formats') {
      const keys = new Set([...Object.keys(a.formats), ...Object.keys(b.formats)]);
      for (const key of keys) {
        if (Math.abs((a.formats[key] || 0) - (b.formats[key] || 0)) >= 0.01) {
          out.push(field);
          break;
        }
      }
      continue;
    }
    if (field === 'length') {
      if (a.length.learn_card_words !== b.length.learn_card_words || a.length.flash_back_words !== b.length.flash_back_words) out.push(field);
      continue;
    }
    if (JSON.stringify(a[field]) !== JSON.stringify(b[field])) out.push(field);
  }
  return out;
}

/**
 * Read whatever the model or the rule parser returned. Accepts
 *   { fields: { difficulty: 'hard', formats: { task: 0.3 } }, summary?: [...] }
 * or a bare field map, or `{ text: "<json>" }` with the JSON as a string.
 * Unknown fields and junk values are dropped, never trusted.
 *
 * @returns {{ fields: object, summary: Array<{field: string, from: string, to: string}>, raw: object }}
 */
export function parseLensDiff(input) {
  let data = input;
  if (typeof data === 'string') data = safeJson(data);
  if (data && typeof data === 'object' && typeof data.text === 'string') data = safeJson(data.text);
  if (!data || typeof data !== 'object') return { fields: {}, summary: [], raw: {} };
  const source = data.fields && typeof data.fields === 'object' ? data.fields : data.diff && typeof data.diff === 'object' ? data.diff : data;
  const fields = {};
  for (const field of LENS_FIELDS) {
    if (!(field in source)) continue;
    const value = source[field];
    if (field === 'formats') {
      const formats = {};
      for (const key of LENS_FORMATS) {
        if (value && typeof value === 'object' && value[key] !== undefined) formats[key] = clamp01(value[key]);
      }
      if (Object.keys(formats).length) fields.formats = formats;
      continue;
    }
    if (field === 'difficulty') {
      const d = String(value || '').toLowerCase();
      if (DIFFICULTIES.includes(d)) fields.difficulty = d;
      continue;
    }
    if (field === 'length' && value && typeof value === 'object') {
      fields.length = {
        learn_card_words: words(value.learn_card_words, 80),
        flash_back_words: words(value.flash_back_words, 30),
      };
      continue;
    }
    if (field === 'emphasis') {
      const items = list(value);
      if (items.length) fields.emphasis = items;
      continue;
    }
    if (typeof value === 'string') fields[field] = value.slice(0, 400);
  }
  const summary = Array.isArray(data.summary)
    ? data.summary
        .filter((row) => row && typeof row === 'object')
        .map((row) => ({ field: String(row.field || ''), from: String(row.from ?? label(row.field, row.from)), to: String(row.to ?? '') }))
        .filter((row) => LENS_FIELDS.includes(row.field))
    : [];
  return { fields, summary, raw: data };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {}
  const start = String(text).indexOf('{');
  const end = String(text).lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(String(text).slice(start, end + 1));
    } catch {}
  }
  return null;
}

/**
 * Apply a parsed diff to a Lens.
 * @returns {{ lens: object, changed: string[], rows: Array<{field, from, to}> }}
 */
export function applyDiff(lens, diff) {
  const before = normaliseLens(lens);
  const fields = diff && diff.fields ? diff.fields : diff || {};
  const merged = { ...before, ...fields };
  if (fields.formats) merged.formats = { ...before.formats, ...fields.formats };
  if (fields.length) merged.length = { ...before.length, ...fields.length };
  const after = normaliseLens(merged);
  const changed = changedFields(before, after);
  const rows = changed.map((field) => ({ field, from: label(field, before[field]), to: label(field, after[field]) }));
  return { lens: after, changed, rows };
}

/** Clear, short diff for the approval bar: "difficulty medium to hard". */
export function diffSentence(rows = []) {
  return rows.map((row) => `${row.field}: ${row.from} \u2192 ${row.to}`);
}

/**
 * Rule based fallback when the LLM is unavailable: keyword matching on a
 * handful of intents. Deterministic and offline-safe, as design 3.7 asks
 * ("hard-coded first, LLM second"). Returns the same shape as parseLensDiff.
 */
export function ruleBasedDiff(prompt) {
  const text = String(prompt || '').toLowerCase();
  const fields = {};
  if (/more scenario|fewer definition|scenario heavy|tasks?/.test(text) && /more|heavy|plus|\+/.test(text)) {
    fields.formats = { flash: 0.15, quiz: 0.2, oral: 0.15, task: 0.5 };
  }
  if (/plain english|simpler|easier/.test(text)) fields.difficulty = 'easy';
  if (/harder|tougher|exam level|stretch/.test(text)) fields.difficulty = 'hard';
  if (/oral|spoken|out loud|aloud|speak/.test(text)) fields.formats = { ...(fields.formats || {}), oral: 0.5, flash: 0.2, quiz: 0.2, task: 0.1 };
  if (/short|brief|terse|commute/.test(text)) fields.length = { learn_card_words: 40, flash_back_words: 15 };
  if (/job app|interview/.test(text)) {
    fields.audience = 'me, preparing for a job interview';
    fields.emphasis = ['trade-offs', 'worked examples'];
  }
  return { fields, summary: [], raw: { source: 'rules', prompt } };
}

/** A Lens preset from design 3.5, as a partial Lens. */
export const LENS_PRESETS = {
  'exam-crammer': { id: 'exam-crammer', title: 'Exam crammer', difficulty: 'hard', formats: { flash: 0.4, quiz: 0.4, oral: 0, task: 0.2 }, length: { learn_card_words: 60, flash_back_words: 20 }, emphasis: ['key numbers', 'definitions'] },
  'oral-exam': { id: 'oral-exam', title: 'Oral exam', difficulty: 'hard', formats: { flash: 0.2, quiz: 0.2, oral: 0.5, task: 0.1 }, tone: 'direct, minimal jargon' },
  'plain-english': { id: 'plain-english', title: 'Plain English', difficulty: 'easy', tone: 'plain words', length: { learn_card_words: 50, flash_back_words: 18 } },
  commute: { id: 'commute', title: 'Commute audio', formats: { flash: 0.2, quiz: 0.2, oral: 0.6, task: 0 }, length: { learn_card_words: 40, flash_back_words: 15 } },
  'scenario-heavy': { id: 'scenario-heavy', title: 'Scenario heavy', formats: { flash: 0.1, quiz: 0.2, oral: 0.2, task: 0.5 }, emphasis: ['trade-offs', 'worked examples'] },
  'teach-back': { id: 'teach-back', title: 'Teach it back', formats: { flash: 0.2, quiz: 0.2, oral: 0, task: 0.6 }, extra: 'Ask me to explain it back before showing the answer.' },
  'flash-only': { id: 'flash-only', title: 'Flash only', formats: { flash: 1 }, length: { learn_card_words: 30, flash_back_words: 12 } },
};

export function presetLens(name, base) {
  const preset = LENS_PRESETS[name];
  if (!preset) return normaliseLens(base || {});
  return normaliseLens({ ...(base || {}), ...preset });
}

/* ---------------------------------------------------------------------- */
/* Dependency tracking (design 6.3)                                        */
/* ---------------------------------------------------------------------- */

/**
 * Which Lens fields each generated item kind depends on. Items record their own
 * `lens_fields` when generated; this table is the default per kind, so an item
 * saved before the field existed is still tracked.
 */
export const DEPENDENCIES = {
  card: ['formats', 'length', 'tone', 'difficulty'],
  flash: ['formats', 'length', 'tone'],
  quiz: ['formats', 'difficulty', 'emphasis'],
  oral: ['formats', 'audience', 'tone', 'extra'],
  task: ['formats', 'difficulty', 'emphasis', 'length'],
  guide: ['audience', 'tone', 'length', 'emphasis'],
  cheat: ['emphasis', 'length'],
  anki: ['formats', 'length'],
  audio: ['formats', 'length', 'tone'],
  certificate: [],
};

export function dependenciesFor(kind, item = {}) {
  const declared = Array.isArray(item.lens_fields) ? item.lens_fields.filter((field) => LENS_FIELDS.includes(field)) : [];
  if (declared.length) return declared;
  return [...(DEPENDENCIES[kind] || [])];
}

/**
 * Items a change makes stale.
 *
 * @param {Array<{id: string, kind: string, lens_fields?: string[]}>} items
 * @param {string[]} changed LENS_FIELDS that changed
 * @returns {{ stale: string[], untouched: string[] }}
 */
export function staleItems(items = [], changed = []) {
  const keys = new Set((changed || []).filter((field) => LENS_FIELDS.includes(field)));
  const stale = [];
  const untouched = [];
  for (const item of items || []) {
    if (!item || !item.id) continue;
    const deps = dependenciesFor(item.kind, item);
    if (deps.some((field) => keys.has(field))) stale.push(item.id);
    else untouched.push(item.id);
  }
  return { stale, untouched };
}

/** Rough regeneration cost, shown before the user approves: "about 40 cards". */
export function regenerationPlan(items = [], changed = [], { msPerItem = 1200 } = {}) {
  const { stale, untouched } = staleItems(items, changed);
  return {
    changed: (changed || []).slice(),
    stale,
    untouched,
    count: stale.length,
    estimateMs: stale.length * msPerItem,
  };
}

/** Facts and progress are never in scope: only generated items are. */
export const REGENERATION_SCOPE = ['generated'];

/** True when an item is a fact or progress doc, which a Lens change must not touch. */
export function isProtectedItem(item = {}) {
  return item.collection === 'facts' || item.collection === 'progress' || item.collection === 'attempts';
}

/** Compact "3 of 7 lenses on this topic" state for the Lens Switcher achievement. */
export function lensUsage(history = []) {
  const byTopic = {};
  for (const entry of history) {
    const topic = String(entry.topicId || 'all');
    byTopic[topic] = byTopic[topic] || new Set();
    byTopic[topic].add(String(entry.lensId || 'default'));
  }
  return Object.fromEntries(Object.entries(byTopic).map(([topic, set]) => [topic, set.size]));
}
