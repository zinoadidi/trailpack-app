// Practice runs give a completed round back to a tiny result screen: right,
// wrong, the best run, and what to do next. The numbers are counted by
// roundStats in practice-deck.js; this file only sums a list of answers so the
// same screen serves the practice deck and a finished practice bite.

/** Sum a list of answers into what a result screen shows. */
export function resultSummary(answers = []) {
  const rows = Array.isArray(answers) ? answers : [];
  let right = 0;
  let wrong = 0;
  let run = 0;
  let best = 0;
  let ms = 0;
  for (const row of rows) {
    const good = Boolean(row && (row.correct === true || row.selfRate === 'good' || row.selfRate === 'easy'));
    if (good) {
      right += 1;
      run += 1;
      best = Math.max(best, run);
    } else {
      wrong += 1;
      run = 0;
    }
    ms += Math.max(0, Number(row && row.ms) || 0);
  }
  const asked = right + wrong;
  return { asked, right, wrong, best, ms, accuracy: asked ? Math.round((right / asked) * 100) : 0 };
}

/** Which activity types were practised, in first seen order. */
export function typesPractised(answers = []) {
  const seen = [];
  for (const row of answers || []) {
    const type = row && row.type;
    if (type && !seen.includes(type)) seen.push(type);
  }
  return seen;
}
