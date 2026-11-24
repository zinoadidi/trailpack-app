// Deadline mode on the home card needs a date from the learner: a plain
// `YYYY-MM-DD` field, saved on the plan. The parsing and the hours left are
// pure, so a bad date is refused before the device ever writes it.

/** Parse a local `YYYY-MM-DD` into the end of that day (23:59 local). */
export function parseDeadline(text, now = Date.now()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || '').trim());
  if (!match) return { ok: false, iso: null, reason: 'format' };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 23, 59, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return { ok: false, iso: null, reason: 'date' };
  if (date.getTime() <= now) return { ok: false, iso: null, reason: 'past' };
  return { ok: true, iso: date.toISOString(), reason: null, days: Math.ceil((date.getTime() - now) / 86400000) };
}

/** The value to put back in the field for an existing deadline. */
export function deadlineInput(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Five equal days per camp left, rounded up, for the sprint sentence. */
export function bitesPerDay(campsLeft, daysLeft) {
  const camps = Math.max(0, Math.round(Number(campsLeft) || 0));
  const days = Math.max(1, Math.round(Number(daysLeft) || 0));
  return Math.max(1, Math.ceil(camps / days));
}
