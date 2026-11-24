// The deadline field of the Trail home (src/screens/trail-deadline.js): a
// plain date is parsed to the end of that local day, bad input is refused
// with a reason, and an existing deadline comes back in the field.

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseDeadline, deadlineInput, bitesPerDay } from '../src/screens/trail-deadline.js';

const NOW = new Date(2026, 10, 20, 12, 0, 0).getTime(); // 20 Nov 2026, local noon

test('a good date is the end of that local day', () => {
  const out = parseDeadline('2026-12-24', NOW);
  assert.equal(out.ok, true);
  const date = new Date(out.iso);
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 11);
  assert.equal(date.getDate(), 24);
  assert.equal(date.getHours(), 23);
  assert.equal(out.days, 35);
});

test('bad shapes and impossible dates are refused', () => {
  assert.deepEqual(parseDeadline('24/12/2026', NOW), { ok: false, iso: null, reason: 'format' });
  assert.equal(parseDeadline('2026-02-31', NOW).reason, 'date');
  assert.equal(parseDeadline('', NOW).reason, 'format');
});

test('a date in the past is refused', () => {
  assert.equal(parseDeadline('2026-11-01', NOW).reason, 'past');
});

test('the deadline ends at the end of the picked day, so today still works before midnight', () => {
  const morning = new Date(2026, 10, 20, 8, 0, 0).getTime();
  assert.equal(parseDeadline('2026-11-20', morning).ok, true, 'later today is still ahead');
  const tomorrow = new Date(2026, 10, 21, 0, 5, 0).getTime();
  assert.equal(parseDeadline('2026-11-20', tomorrow).reason, 'past');
});

test('an existing deadline reads back into the field', () => {
  assert.equal(deadlineInput(null), '');
  assert.equal(deadlineInput('not a date'), '');
  assert.equal(deadlineInput(new Date(2026, 0, 5, 23, 59).toISOString()), '2026-01-05');
});

test('bites per day never says zero', () => {
  assert.equal(bitesPerDay(0, 5), 1);
  assert.equal(bitesPerDay(10, 5), 2);
  assert.equal(bitesPerDay(3, 0), 3);
  assert.equal(bitesPerDay(null, null), 1);
});
