// Shared answer reconciliation for the activities (M5, agent A).
//
// One rule, used by every activity that has a right answer: an activity first
// asks itself whether the learner was right. When the variant has no `why`
// line, the fact's own statement is the short explanation, which is always
// present and is honest (it is what the Pack says).
//
// Text comparison for typed answers lives here too: trim, lower case, fold
// accents, drop a leading article and trailing punctuation, and accept a
// small edit distance for typos. That is the "fuzzy" scoring the catalogue
// promises for fill the blank.

/** Lower case, no accents, no punctuation, single spaces. */
export function fold(text) {
  return String(text === undefined || text === null ? '' : text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Edit distance, capped early when it is already larger than `max`. */
export function distance(a, b, max = 3) {
  const s = fold(a);
  const t = fold(b);
  if (s === t) return 0;
  if (Math.abs(s.length - t.length) > max) return max + 1;
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= t.length; j += 1) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
    }
    if (Math.min(...row) > max) return max + 1;
    prev = row;
  }
  return prev[t.length];
}

/** How forgiving a typed answer is: 0 for words 3 letters or shorter. */
export function typoBudget(text) {
  const clean = fold(text);
  if (clean.length <= 3) return 0;
  if (clean.length <= 6) return 1;
  return 2;
}

/** A typed answer against the expected word or phrase. */
export function matchesTyped(given, expected) {
  const want = fold(expected).replace(/^(the|a|an|der|die|das|le|la|les|el|los|las)\s+/, '');
  const got = fold(given).replace(/^(the|a|an|der|die|das|le|la|les|el|los|las)\s+/, '');
  if (!got) return false;
  if (got === want) return true;
  return distance(got, want, typoBudget(want)) <= typoBudget(want);
}

/** Quality 0 to 1 for the mastery engine: right is 1, right with a hint 0.7. */
export function qualityOf({ correct, hint = false, ms = 0 }) {
  if (!correct) return 0;
  if (hint) return 0.7;
  // A confident, quick answer is not better than a slow right one for
  // mastery (that is the schedule's job), so speed only nudges the last 0.1.
  return ms > 0 && ms < 4000 ? 1 : 0.95;
}

/**
 * Build the object every activity passes to `ctx.onAnswer`. `variant` is the
 * variant being shown, `fact` the fact it belongs to.
 */
export function makeAnswer({ correct, variant = {}, fact = {}, ms = 0, hint = false, answer = null, selfRate = null }) {
  const base = {
    correct: Boolean(correct),
    why: (variant && variant.why) || (fact && fact.statement) || '',
    quality: qualityOf({ correct, hint, ms }),
    ms,
    hint,
    answer,
  };
  if (selfRate) base.selfRate = selfRate;
  return base;
}
