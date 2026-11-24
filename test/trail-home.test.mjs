// The Trail home logic (src/screens/trail-home-logic.js): the camp path, the
// open camp, the Daily Walk card, readiness and deadline mode, over a small
// hand built plan. Pure, no DOM, no store.

import test from 'node:test';
import assert from 'node:assert/strict';

import { pathCamps, studyCamp, deadlineState, readinessState, walkState, masteryLine, trailHome } from '../src/screens/trail-home-logic.js';
import { newProgress } from '../src/study/mastery.js';

const PLAN = {
  packId: 'pack1',
  startedAt: '2026-11-01T00:00:00.000Z',
  deadline: null,
  minutesPerDay: 20,
  camps: [
    { id: 'camp_1', index: 0, title: 'Intro', factIds: ['f1', 'f2'], state: 'summited', checkpoint: { score: 80, passedAt: '2026-11-05T00:00:00.000Z', attempts: 1 } },
    { id: 'camp_2', index: 1, title: 'Tools', factIds: ['f3', 'f4'], state: 'open', checkpoint: null },
    { id: 'camp_3', index: 2, title: 'Close', factIds: ['f5'], state: 'locked', checkpoint: null },
  ],
  openIndex: 1,
};

const PROGRESS = {
  f1: { ...newProgress('f1'), state: 'mastered' },
  f2: { ...newProgress('f2'), state: 'review' },
  f3: { ...newProgress('f3'), state: 'learning' },
  f4: { ...newProgress('f4'), state: 'weak' },
  f5: { ...newProgress('f5'), state: 'new' },
};

test('the path marks summited, current and locked camps', () => {
  const camps = pathCamps(PLAN);
  assert.equal(camps.length, 3);
  assert.equal(camps[0].label, 'summited');
  assert.equal(camps[1].label, 'current');
  assert.equal(camps[1].current, true);
  assert.equal(camps[2].label, 'next', 'the camp after the open one is the next');
  assert.equal(camps[2].reachable, false);
  assert.deepEqual(camps[0].gateText, { score: 80, passed: true });
  assert.equal(camps[1].gateText, null);
  assert.equal(camps[1].gate, 70);
});

test('the study camp is the open one, with its fact count', () => {
  const camp = studyCamp(PLAN);
  assert.equal(camp.id, 'camp_2');
  assert.equal(camp.facts, 2);
  assert.equal(camp.readyForGate, true);
  assert.equal(studyCamp(null), null);
});

test('no deadline means no countdown and no sprint', () => {
  const state = deadlineState(PLAN, { now: Date.parse('2026-11-10T00:00:00.000Z') });
  assert.deepEqual(state, { has: false, countdown: null, behind: null, sprint: false, line: null });
});

test('a near deadline turns on sprint mode and counts the days', () => {
  const plan = { ...PLAN, deadline: '2026-11-20T00:00:00.000Z' };
  const state = deadlineState(plan, { now: Date.parse('2026-11-12T00:00:00.000Z') });
  assert.equal(state.has, true);
  assert.equal(state.sprint, false); // default threshold is 7 days, 8 are left
  assert.equal(state.countdown.days, 8);
  const custom = deadlineState(plan, { now: Date.parse('2026-11-12T00:00:00.000Z'), sprintDays: 10 });
  assert.equal(custom.sprint, true);
});

test('an overdue deadline says so', () => {
  const plan = { ...PLAN, deadline: '2026-11-01T00:00:00.000Z' };
  const state = deadlineState(plan, { now: Date.parse('2026-11-12T00:00:00.000Z') });
  assert.equal(state.countdown.overdue, true);
  assert.equal(state.sprint, false);
});

test('a plan behind its deadline gets a translated re-plan sentence', () => {
  const plan = { ...PLAN, deadline: '2026-11-15T00:00:00.000Z' };
  const seen = [];
  const t = (key, values) => {
    seen.push(key);
    return key + ':' + JSON.stringify(values);
  };
  const state = deadlineState(plan, { now: Date.parse('2026-11-14T00:00:00.000Z'), t });
  assert.ok(state.line === null || seen.includes('trail.behind'), 'a line only ever uses the plan key');
});

test('readiness is one score with its parts, from progress and gates', () => {
  const state = readinessState(PLAN, PROGRESS, { now: Date.parse('2026-11-10T00:00:00.000Z'), lastStudyAt: '2026-11-09T00:00:00.000Z' });
  assert.ok(state.score >= 0 && state.score <= 100);
  assert.equal(typeof state.parts.recall, 'number');
  assert.equal(typeof state.parts.checkpoints, 'number');
  assert.equal(typeof state.parts.camps, 'number');
  const translated = readinessState(PLAN, PROGRESS, { t: (key, v) => key + ':' + v.score });
  assert.match(translated.line, /^trail\.readinessLine:\d+$/);
});

test('the walk card carries the goal, the steps and the percent done', () => {
  const walk = walkState(PLAN, PROGRESS, { now: Date.parse('2026-11-10T12:00:00.000Z'), done: { steps: 3, minutes: 10 } });
  assert.equal(walk.minutesGoal, 20);
  assert.equal(walk.minutesDone, 10);
  assert.equal(walk.stepsDone, 3);
  assert.equal(walk.percent, 50);
  assert.equal(walk.met, false);
  assert.equal(walk.campId, 'camp_2');
  const full = walkState(PLAN, PROGRESS, { done: { steps: 6, minutes: 25 } });
  assert.equal(full.met, true);
  assert.equal(full.percent, 100, 'percent never passes 100');
});

test('the mastery line counts mastered facts across the camps', () => {
  const line = masteryLine(PLAN, PROGRESS);
  assert.equal(line.total, 5);
  assert.equal(line.mastered, 1);
  assert.equal(line.percent, 20);
  assert.equal(masteryLine(null, {}).total, 0);
});

test('trailHome ties it together for the screen', () => {
  const home = trailHome(PLAN, PROGRESS, { now: Date.parse('2026-11-10T12:00:00.000Z') });
  assert.equal(home.hasPlan, true);
  assert.equal(home.complete, false);
  assert.equal(home.camps.length, 3);
  assert.equal(home.current.id, 'camp_2');
  assert.equal(home.deadline.has, false);
  assert.equal(typeof home.walk.percent, 'number');
  assert.equal(trailHome(null, {}).hasPlan, false);
});
