// Matching: the one rule shared by every scored activity. Fill the blank,
// voice coverage and teach-back all compare free text to an expected answer,
// and small typos should not count as a miss.
//
// Pure functions, no DOM. `normalise` folds case, accents and punctuation;
// `similar` is a character-level edit distance ratio.

export function normalise(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function words(text) {
  const value = normalise(text);
  return value ? value.split(' ') : [];
}

/** Levenshtein distance, iterative with two rows (short strings only). */
export function editDistance(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  let curr = new Array(t.length + 1);
  for (let i = 1; i <= s.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[t.length];
}

/** 1 for identical, 0 for nothing in common. */
export function similarity(a, b) {
  const s = normalise(a);
  const t = normalise(b);
  if (!s && !t) return 1;
  const longest = Math.max(s.length, t.length);
  if (!longest) return 1;
  return 1 - editDistance(s, t) / longest;
}

/**
 * Is a cloze answer right? A short answer allows one typo in five letters;
 * a longer one needs 80% similarity. `alternatives` are other accepted forms.
 */
export function clozeMatches(answer, expected, alternatives = []) {
  const given = normalise(answer);
  if (!given) return false;
  const wanted = [expected, ...(alternatives || [])].map(normalise).filter(Boolean);
  for (const option of wanted) {
    if (given === option) return true;
    if (!option) continue;
    const tolerance = option.length <= 2 ? 0 : option.length < 6 ? 1 : 2;
    if (Math.abs(given.length - option.length) <= tolerance && editDistance(given, option) <= tolerance) return true;
    if (option.includes(' ') && similarity(given, option) >= 0.85) return true;
  }
  return false;
}

/** Stop words that carry no meaning when checking coverage. */
const STOP = new Set(
  'a an the and or of in on at to for from with without is are was were be been it its this that these those as by not no if then than so we you they i he she my our your their there here what which who how why when do does did can could should would may might will'.split(
    ' ',
  ),
);

export function contentWords(text) {
  return words(text).filter((w) => w.length > 2 && !STOP.has(w));
}

/**
 * Coverage of expected points by an answer (design 3.7: a keyword check that
 * works offline; the LLM score only adds on top).
 *
 * @param {string} answer
 * @param {string[]} points expected points, each a phrase
 * @returns {{hit: string[], missed: string[], ratio: number}}
 */
export function coverage(answer, points = []) {
  const said = new Set(contentWords(answer));
  const sentences = words(answer);
  const joined = ' ' + sentences.join(' ') + ' ';
  const hit = [];
  const missed = [];
  for (const point of points || []) {
    const keys = contentWords(point);
    if (!keys.length) continue;
    // A point counts when its key words appear, or 60% of them do and at
    // least two matched (so a one word phrase does not ride on noise).
    const found = keys.filter((k) => said.has(k) || joined.includes(' ' + k));
    if (found.length === keys.length || (keys.length >= 3 && found.length / keys.length >= 0.6)) hit.push(point);
    else missed.push(point);
  }
  const total = hit.length + missed.length;
  return { hit, missed, ratio: total ? hit.length / total : 0 };
}

/** Fuzzy answer check for short typed answers (names, numbers, one liners). */
export function answerMatches(answer, expected, { tolerance = 0.8 } = {}) {
  if (clozeMatches(answer, expected)) return true;
  return similarity(answer, expected) >= tolerance;
}
