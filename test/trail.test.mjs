import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GATE_PERCENT,
  applyCheckpoint,
  campStates,
  checkpointScore,
  countdown,
  dailyWalk,
  gateFacts,
  planCamps,
  planId,
  readiness,
  replay,
  trailComplete,
} from '../src/study/trail.js';
import { newProgress } from '../src/study/mastery.js';

const DAY = 86400000;
const T0 = new Date(2026, 10, 24, 9, 0, 0).getTime();

function pack(topics = 4, factsPer = 8) {
  const t = Array.from({ length: topics }, (_, i) => ({ id: 't' + i, title: 'Topic ' + (i + 1), order: i }));
  const facts = [];
  for (const topic of t) {
    for (let i = 0; i < factsPer; i += 1) facts.push({ id: `${topic.id}_f${i}`, topicId: topic.id, statement: 'A fact lives here, yes.' });
  }
  return { topics: t, facts };
}

test('camps group topics and pack facts without splitting a topic that fits', () => {
  const { topics, facts } = pack(4, 8);
  const camps = planCamps(topics, facts, { maxFactsPerCamp: 12 });
  assert.ok(camps.length >= 2);
  assert.equal(camps[0].state, 'open');
  assert.equal(camps[1].state, 'locked');
  const covered = camps.flatMap((camp) => camp.factIds);
  assert.equal(covered.length, facts.length);
  assert.equal(new Set(covered).size, facts.length, 'no fact in two camps');
  assert.ok(camps[0].topicIds.length >= 1);
});

test('a small pack is one camp', () => {
  const { topics, facts } = pack(1, 3);
  const camps = planCamps(topics, facts);
  assert.equal(camps.length, 1);
  assert.equal(camps[0].title, 'Topic 1');
});

test('uncertain facts are held back from the gate', () => {
  const { topics, facts } = pack(1, 4);
  facts[0].check = 1;
  const camps = planCamps(topics, facts);
  const gated = gateFacts(camps[0], facts);
  assert.equal(gated.length, 3);
});

test('a checkpoint passes at 70 percent and opens the next camp', () => {
  const { topics, facts } = pack(2, 5);
  const trail = { camps: planCamps(topics, facts, { maxFactsPerCamp: 5 }) };
  const camp = trail.camps[0];
  const answers = camp.factIds.map((id, i) => ({ factId: id, correct: i < 4 })); // 80%
  const result = applyCheckpoint(trail, camp.id, answers, { when: T0 });
  assert.equal(result.passed, true);
  assert.equal(result.score, 80);
  assert.equal(result.trail.camps[0].state, 'summited');
  assert.equal(result.trail.camps[1].state, 'open');
});

test('a failed checkpoint lists the facts to revisit and leaves the camp open', () => {
  const { topics, facts } = pack(2, 5);
  const trail = { camps: planCamps(topics, facts, { maxFactsPerCamp: 5 }) };
  const camp = trail.camps[0];
  const answers = camp.factIds.map((id, i) => ({ factId: id, correct: i < 2 })); // 40%
  const result = applyCheckpoint(trail, camp.id, answers);
  assert.equal(result.passed, false);
  assert.equal(result.score, 40);
  assert.equal(result.missed.length, 3);
  assert.equal(result.trail.camps[0].state, 'open');
  assert.equal(GATE_PERCENT, 70);
});

test('checkpoint score is a plain share of the camp', () => {
  const camp = { factIds: ['a', 'b', 'c', 'd'] };
  assert.deepEqual(checkpointScore(camp, [{ correct: true }, { correct: false }, { correct: true }, { correct: true }]), { score: 75, correct: 3, total: 4 });
  assert.equal(checkpointScore({ factIds: [] }, []).score, 100);
});

test('the trail is complete only when every camp is summited', () => {
  const { topics, facts } = pack(2, 4);
  let trail = { camps: planCamps(topics, facts, { maxFactsPerCamp: 4 }) };
  assert.equal(trailComplete(trail), false);
  for (const camp of [...trail.camps]) {
    trail = applyCheckpoint(trail, camp.id, camp.factIds.map((factId) => ({ factId, correct: true }))).trail;
  }
  assert.equal(trailComplete(trail), true);
  assert.equal(trailComplete({ camps: [] }), false);
});

test('readiness is a weighted mix between 0 and 100 and rises with mastery', () => {
  const { facts } = pack(1, 4);
  const ids = facts.map((f) => f.id);
  const trailOf = (factIds) => ({ camps: [{ id: 'camp_1', factIds, state: 'open', checkpoint: null }] });
  const empty = readiness({ progress: {}, factIds: ids, now: T0 });
  const progress = Object.fromEntries(ids.map((id) => [id, { ...newProgress(id), state: 'mastered' }]));
  const done = readiness({ progress, factIds: ids, lastStudyAt: new Date(T0).toISOString(), now: T0 });
  assert.ok(done.score > empty.score);
  assert.ok(done.score <= 100);
  assert.equal(done.score, 100);
  const stale = readiness({ progress, factIds: ids, lastStudyAt: new Date(T0 - 10 * DAY).toISOString(), now: T0 });
  assert.ok(stale.score < done.score, 'old activity lowers readiness');
  const withMock = readiness({ progress, factIds: ids, trail: trailOf(ids), mockScore: 0.5, lastStudyAt: new Date(T0).toISOString(), now: T0 });
  assert.equal(withMock.parts.mock, 50);
  assert.ok(withMock.score < done.score, 'a weak mock pulls the estimate down');
});

test('the daily walk is a minutes goal with 3 to 6 steps', () => {
  const { topics, facts } = pack(1, 8);
  const trail = { camps: planCamps(topics, facts) };
  const progress = Object.fromEntries(facts.map((f) => [f.id, { ...newProgress(f.id), state: 'learning', dueAt: T0 - 1000 }]));
  const walk = dailyWalk({ trail, progress, now: T0, minutesPerDay: 30, minutesDoneToday: 10 });
  assert.ok(walk.stepsTarget >= 3 && walk.stepsTarget <= 6);
  assert.equal(walk.dueFacts, facts.length);
  assert.equal(walk.met, false);
  assert.equal(walk.minutesGoal, 30);
});

test('countdown shows days and hours to the deadline', () => {
  const out = countdown(T0 + 2 * DAY + 3 * 3600000, T0);
  assert.equal(out.has, true);
  assert.equal(out.days, 2);
  assert.equal(out.hours, 3);
  assert.equal(countdown(null, T0).has, false);
  assert.equal(countdown(T0 - DAY, T0).overdue, true);
});

test('re-plan says plainly when the plan is behind', () => {
  const { topics, facts } = pack(4, 6);
  const camps = planCamps(topics, facts, { maxFactsPerCamp: 6 });
  const behind = replay({ startedAt: T0 - 6 * DAY, deadline: T0 + 2 * DAY, camps, now: T0 });
  assert.ok(behind.behindDays >= 1);
  assert.equal(behind.message.key, 'trail.behind');
  const ahead = replay({ startedAt: T0 - 1 * DAY, deadline: T0 + 30 * DAY, camps, now: T0 });
  assert.equal(ahead.behindDays, 0);
  assert.equal(ahead.message, null);
});

test('camp labels mark done, current, next and locked', () => {
  const { topics, facts } = pack(3, 4);
  const trail = { camps: planCamps(topics, facts, { maxFactsPerCamp: 4 }) };
  const labels = campStates(trail).map((row) => row.label);
  assert.equal(labels[0], 'current');
  assert.equal(labels[1], 'next');
  assert.equal(labels[2], 'locked');
});

test('plan ids are sync safe', () => {
  assert.match(planId('pack_Intro to PM'), /^[A-Za-z0-9_-]{1,64}$/);
});
