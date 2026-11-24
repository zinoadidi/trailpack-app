import test from 'node:test';
import assert from 'node:assert/strict';

import {
  INTERVALS_MIN,
  dayOf,
  deadlinePlan,
  dueFacts,
  exhaustedQueue,
  intakePlan,
  intervalFor,
  isDue,
  masterySummary,
  meetsMasteredRule,
  newProgress,
  normaliseProgress,
  recordAttempt,
} from '../src/study/mastery.js';

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date(2026, 10, 24, 9, 0, 0).getTime(); // local time, 24 Nov 2026

function correctDays(p, days, type = 'quiz') {
  let out = p;
  days.forEach((offset, i) => {
    out = recordAttempt(out, { correct: true, type: i === 0 ? 'cloze' : type, when: T0 + offset * DAY + i * 1000 }).progress;
  });
  return out;
}

test('schedule is 10 minutes, 1, 3, 7, 14 and 30 days', () => {
  assert.deepEqual(INTERVALS_MIN, [10, 1440, 4320, 10080, 20160, 43200]);
  assert.deepEqual(INTERVALS_MIN.map((m) => intervalFor(INTERVALS_MIN.indexOf(m))), INTERVALS_MIN);
});

test('a correct answer on a new fact moves it to learning and 1 day out', () => {
  const { progress, promoted } = recordAttempt(newProgress('f1'), { correct: true, type: 'flash', when: T0 });
  assert.equal(progress.state, 'learning');
  assert.equal(progress.step, 1);
  assert.equal(progress.dueAt, T0 + DAY);
  assert.equal(promoted, true);
  assert.equal(isDue(progress, T0 + 1000), false);
});

test('mastered needs 3 recalls on 3 days in 2 types with one production', () => {
  const one = recordAttempt(newProgress('f'), { correct: true, type: 'flash', when: T0 }).progress;
  const two = recordAttempt(one, { correct: true, type: 'quiz', when: T0 + DAY }).progress;
  const three = recordAttempt(two, { correct: true, type: 'quiz', when: T0 + 2 * DAY });
  assert.equal(three.progress.correct, 3);
  assert.equal(meetsMasteredRule(three.progress), false, 'no production type yet');
  assert.notEqual(three.progress.state, 'mastered');

  const four = recordAttempt(three.progress, { correct: true, type: 'cloze', when: T0 + 3 * DAY });
  assert.equal(four.progress.state, 'mastered');
  assert.equal(four.mastered, true);
  assert.equal(four.progress.masteredAt, T0 + 3 * DAY);
});

test('three recalls on one day are not mastery', () => {
  let p = newProgress('f');
  for (let i = 0; i < 3; i += 1) p = recordAttempt(p, { correct: true, type: i === 2 ? 'cloze' : 'quiz', when: T0 + i * 60000 }).progress;
  assert.equal(p.days.length, 1);
  assert.equal(meetsMasteredRule(p), false);
});

test('a miss makes the fact weak, due in 30 minutes, one step back', () => {
  // Two recalls: still Learning, so a miss takes one step, not two.
  const p = correctDays(newProgress('f'), [0, 1]);
  assert.equal(p.state, 'review');
  assert.equal(p.step, 2);
  const miss = recordAttempt(p, { correct: false, type: 'quiz', when: T0 + 2 * DAY });
  assert.equal(miss.progress.state, 'weak');
  assert.equal(p.step, 2, 'three recalls crossed two schedule steps');
  // A miss takes one step back, and weak facts come back this session.
  assert.equal(miss.progress.step, 1);
  assert.equal(miss.progress.dueAt, T0 + 2 * DAY + 30 * 60 * 1000);
  assert.equal(miss.weak, true);
  assert.equal(miss.progress.lapses, 1);
  assert.equal(miss.progress.streak, 0);
});

test('a mastered fact that lapses goes back two steps and loses mastery', () => {
  const p = correctDays(newProgress('f'), [0, 1, 2, 3]);
  assert.equal(p.state, 'mastered');
  const miss = recordAttempt(p, { correct: false, type: 'quiz', when: T0 + 20 * DAY });
  assert.equal(miss.progress.state, 'weak');
  assert.equal(miss.progress.step, p.step - 2);
  assert.equal(miss.demoted, true);
  // It can be mastered again after the rule is met once more.
  const again = recordAttempt(miss.progress, { correct: true, type: 'flash', when: T0 + 21 * DAY });
  assert.equal(again.progress.days.length, 5);
});

test('self rated flashcards count as correct on good and easy', () => {
  const good = recordAttempt(newProgress('f'), { correct: false, selfRate: 'good', type: 'flash', when: T0 });
  assert.equal(good.progress.correct, 1);
  const again = recordAttempt(newProgress('f'), { correct: false, selfRate: 'again', type: 'flash', when: T0 });
  assert.equal(again.progress.state, 'weak');
});

test('intervals compress in deadline mode', () => {
  assert.equal(intervalFor(5), 30 * 1440);
  const short = intervalFor(5, { deadlineMode: true, packProgress: 1 });
  assert.ok(short < 30 * 1440);
  assert.ok(intervalFor(0, { deadlineMode: true }) >= 10);
});

test('deadline plan counts days and flips deadline mode inside a week', () => {
  const plan = deadlinePlan({ deadline: T0 + 3 * DAY, now: T0, factsLeft: 80 });
  assert.equal(plan.daysLeft, 3);
  assert.equal(plan.mode, 'sprint');
  assert.equal(plan.deadlineMode, true);
  assert.ok(plan.bitesPerDay >= 1);
  const later = deadlinePlan({ deadline: T0 + 40 * DAY, now: T0 });
  assert.equal(later.mode, 'normal');
  assert.equal(later.deadlineMode, false);
});

test('due facts group by state and respect dueAt', () => {
  const p = {
    a: { ...newProgress('a', { now: T0 }), state: 'review', dueAt: T0 - 1 },
    b: { ...newProgress('b', { now: T0 }), state: 'review', dueAt: T0 + DAY },
    c: newProgress('c', { now: T0 }),
    d: { ...newProgress('d', { now: T0 }), state: 'mastered', dueAt: T0 - 5 },
  };
  const out = dueFacts(p, { now: T0 });
  assert.deepEqual(out.due.sort(), ['a', 'c', 'd']);
  assert.equal(out.counts.review, 2);
  assert.equal(out.counts.new, 1);
  assert.equal(out.total, 4);
});

test('intake is about 30 percent and pauses when reviews pile up', () => {
  const normal = intakePlan({ newAvailable: 50, dueReviews: 12, steps: 10 });
  assert.equal(normal.intake, 3);
  const heavy = intakePlan({ newAvailable: 50, dueReviews: 60, steps: 10 });
  assert.equal(heavy.intake, 0);
  assert.equal(heavy.paused, true);
  const light = intakePlan({ newAvailable: 50, dueReviews: 0, steps: 10 });
  assert.ok(light.intake > normal.intake);
  const none = intakePlan({ newAvailable: 0, dueReviews: 5, steps: 8 });
  assert.equal(none.intake, 0);
});

test('exhausted new material still fills a bite, weak first then sweeps', () => {
  const states = { weak: ['w1'], learning: ['l1', 'l2'], review: ['r1', 'r2', 'r3'], mastered: ['m1', 'm2'], new: [] };
  const weak = exhaustedQueue(states, ['r1'], { steps: 5, all: ['w1', 'l1', 'l2', 'r1', 'r2', 'r3', 'm1', 'm2'] });
  assert.equal(weak.queue[0], 'w1');
  assert.equal(weak.mode, 'weak');
  assert.equal(weak.queue.length, 5);
  assert.equal(new Set(weak.queue).size, weak.queue.length);

  const sweep = exhaustedQueue({ weak: [], learning: [], review: [], mastered: ['m1', 'm2', 'm3'] }, [], { steps: 3 });
  assert.equal(sweep.mode, 'sweep');
  assert.deepEqual(sweep.queue, ['m1', 'm2', 'm3']);
  assert.equal(sweep.message.key, 'study.masterySweep');

  const empty = exhaustedQueue({ weak: [], learning: [], review: [], mastered: [] }, [], { steps: 4 });
  assert.equal(empty.mode, 'empty');
  assert.equal(empty.queue.length, 0);
});

test('mastery summary counts states and the percentage', () => {
  const p = {
    a: { ...newProgress('a'), state: 'mastered' },
    b: { ...newProgress('b'), state: 'learning' },
  };
  const out = masterySummary(p, ['a', 'b', 'c', 'd']);
  assert.equal(out.total, 4);
  assert.equal(out.mastered, 1);
  assert.equal(out.percent, 25);
  assert.equal(out.toGo, 3);
  assert.equal(out.counts.new, 2);
});

test('normalise fills a partial doc and clamps a bad step', () => {
  const p = normaliseProgress({ factId: 'x', step: 99, state: 'nonsense', days: ['a', 'a'] }, 'x');
  assert.equal(p.step, INTERVALS_MIN.length - 1);
  assert.equal(p.state, 'new');
  assert.deepEqual(p.days, ['a']);
});

test('day key is local, not UTC', () => {
  assert.equal(dayOf(new Date(2026, 10, 24, 23, 30)), '2026-11-24');
  assert.equal(dayOf(new Date(2026, 0, 1, 0, 5)), '2026-01-01');
});
