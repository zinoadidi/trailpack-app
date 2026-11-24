import test from 'node:test';
import assert from 'node:assert/strict';

import {
  startSession,
  currentStep,
  answerStep,
  finishSession,
  isComplete,
  sessionPoints,
  sessionAttempts,
  stepVariant,
  stepPlayable,
  studyQueue,
  normaliseAnswer,
  biteStreak,
  stepReward,
  biteId,
} from '../src/study/session.js';
import { newProgress, recordAttempt } from '../src/study/mastery.js';
import { defaultSettings } from '../src/study/mixer-settings.js';

/** A fact with one variant per asked type, so the mixer has choice. */
function fact(id, types = ['flashcard', 'multiple-choice', 'true-false', 'cloze', 'match'], topicId = 't1') {
  const variants = types.map((type, i) => {
    if (type === 'flashcard') return { id: `${id}_f`, factId: id, type, front: 'Q ' + id, back: 'A ' + id };
    if (type === 'multiple-choice') return { id: `${id}_q`, factId: id, type, prompt: 'P ' + id, choices: ['a', 'b'], answer: 0 };
    if (type === 'true-false') return { id: `${id}_tf`, factId: id, type, statement: 'S ' + id, answer: true };
    if (type === 'cloze') return { id: `${id}_c`, factId: id, type, text: 'The ___ is here', answer: 'thing' };
    if (type === 'match') return { id: `${id}_m`, factId: id, type, pairs: [{ term: 'a', meaning: '1' }, { term: 'b', meaning: '2' }, { term: 'c', meaning: '3' }] };
    return { id: `${id}_${i}`, factId: id, type };
  });
  return { id, packId: 'p1', topicId, statement: 'Statement ' + id, variants };
}

const PACK = Array.from({ length: 12 }, (_, i) => fact('fact_' + (i + 1)));

function trailFor(facts) {
  return { camps: [{ id: 'camp_1', index: 0, title: 'One', factIds: facts.map((f) => f.id), state: 'open', checkpoint: null }], openIndex: 0 };
}

test('a new pack still produces a bite of 6 to 10 real steps', () => {
  const session = startSession({ facts: PACK, progress: {}, trail: trailFor(PACK), steps: 8, seed: 3 });
  assert.equal(session.steps.length, 8);
  assert.equal(session.index, 0);
  assert.equal(getTypes(session).length >= 3, true, 'at least three types');
  for (const step of session.steps) {
    assert.ok(PACK.some((f) => f.id === step.factId), step.factId + ' is a real fact');
    assert.ok(step.factId);
  }
});

test('the same seed gives the same bite', () => {
  const a = startSession({ facts: PACK, progress: {}, steps: 7, seed: 42 });
  const b = startSession({ facts: PACK, progress: {}, steps: 7, seed: 42 });
  assert.deepEqual(a.steps, b.steps);
});

test('a time budget chooses a bite length in range', () => {
  const short = startSession({ facts: PACK, progress: {}, minutes: 3, seed: 1 });
  const long = startSession({ facts: PACK, progress: {}, minutes: 10, seed: 1 });
  assert.ok(short.steps.length >= 6 && short.steps.length <= 10);
  assert.ok(long.steps.length >= short.steps.length);
});

test('intake is about 30 percent new and drops when the queue is heavy', () => {
  const queue = studyQueue({ facts: PACK, progress: {}, steps: 10 });
  assert.ok(queue.intake >= 1 && queue.intake <= 5);
  // 50 due reviews: intake pauses.
  const heavy = {};
  for (let i = 0; i < 50; i += 1) heavy['r' + i] = { ...newProgress('r' + i), state: 'review', dueAt: 1 };
  const paused = studyQueue({ facts: PACK, progress: heavy, steps: 10 });
  assert.equal(paused.paused, true);
  assert.equal(paused.intake, 0);
});

test('answering a step records mastery and advances', () => {
  const session = startSession({ facts: PACK, progress: {}, steps: 6, seed: 5 });
  const step = currentStep(session);
  const out = answerStep(session, { correct: true, selfRate: 'good' }, { now: Date.now() });
  assert.equal(out.session.index, 1);
  assert.equal(out.step.factId, step.factId);
  assert.equal(out.answer.correct, true);
  assert.equal(out.result.progress.correct, 1);
  assert.equal(out.session.answers.length, 1);
  assert.equal(out.done, false);
  assert.ok(out.session.progress[step.factId], 'progress doc kept on the session');
  assert.ok(sessionPoints(out.session) > 0);
});

test('a wrong answer flags the fact weak and does not pay points', () => {
  const session = startSession({ facts: PACK, progress: {}, steps: 6, seed: 9 });
  const step = currentStep(session);
  const out = answerStep(session, { correct: false }, { now: Date.now() });
  assert.equal(out.result.progress.state, 'weak');
  assert.equal(out.session.answers[0].points, 0);
  assert.equal(out.session.progress[step.factId].state, 'weak');
});

test('a flashcard answer is a self rating, not a right or wrong', () => {
  const answered = normaliseAnswer({ selfRate: 'good' }, 'flash');
  assert.equal(answered.correct, true);
  const again = normaliseAnswer({ selfRate: 'again' }, 'flash');
  assert.equal(again.correct, false);
});

test('bites over three days, in two types with one production, master a fact', () => {
  // The mastery engine needs three correct recalls, on three days, in two
  // activity types, one of them production. This feeds sessions the way the
  // study screen does: one progress map, updated in place, day by day.
  const day = 86400000;
  const base = localNoon(2026, 2, 3);
  const facts = PACK.slice(0, 3).map((f) => ({ ...f, variants: [...f.variants, { id: f.id + '_c2', factId: f.id, type: 'cloze', text: 'The ___ is here', answer: 'thing' }] }));
  const progress = {};
  for (let round = 0; round < 3; round += 1) {
    // 09:00 local, not UTC: the mastery engine counts local days on purpose.
    const now = base + round * day;
    let session = startSession({ facts, progress, steps: 10, seed: 40 + round, now });
    while (!isComplete(session)) {
      session = answerStep(session, { correct: true, selfRate: 'good' }, { now }).session;
    }
    for (const [id, doc] of Object.entries(session.factProgress)) progress[id] = doc;
  }
  // Every day's local key reached the doc: two recalls on one day count once.
  // The list is capped at the last three days (HISTORY_KEEP is about attempts,
  // not days), so the newest key is the check.
  const days = new Set(Object.values(progress).flatMap((doc) => doc.days));
  for (let round = 0; round < 3; round += 1) assert.ok(days.has(localKey(base + round * day)), 'day ' + round + ' on the docs');
  const summary = finishSession({ steps: [], answers: [], index: 0, factProgress: progress }, { factIds: facts.map((f) => f.id) });
  assert.equal(summary.mastery.total, 3);
  // Three recalls on three days happened for every fact, so the rule now turns
  // on the two types and the production shape, which the mixer provides.
  // Two facts get a production shape and enough types on day three; the third
  // shows how the rule really behaves (it needs a production type too).
  assert.ok(summary.mastery.mastered >= 2, 'mastered by the real rule: ' + JSON.stringify(summary.mastery.counts));
  assert.ok(Object.values(progress).every((doc) => doc.days.length >= 2), 'days accumulate');
  assert.ok(Object.values(progress).some((doc) => doc.types.length >= 2), 'types accumulate');
  assert.ok(Object.values(progress).some((doc) => doc.production === true), 'a production type was seen');
});

test('a bite answered in one sitting cannot master anything yet', () => {
  // One day only: the "three different days" rule stops it, which is the
  // honest reason a learner sees the same fact again tomorrow.
  let session = startSession({ facts: PACK.slice(0, 3), progress: {}, steps: 8, seed: 50 });
  while (!isComplete(session)) {
    session = answerStep(session, { correct: true, selfRate: 'good' }).session;
  }
  const summary = finishSession(session, { factIds: PACK.slice(0, 3).map((f) => f.id) });
  assert.equal(summary.mastery.mastered, 0);
  assert.ok(Object.values(session.factProgress).every((doc) => doc.correct >= 1));
});

test('finishing lists what was right, mastered and weak', () => {
  let session = startSession({ facts: PACK, progress: {}, steps: 6, seed: 2 });
  const outcomes = [true, false, true, true, false, true];
  for (const correct of outcomes) {
    const out = answerStep(session, { correct }, { now: Date.now() });
    session = out.session;
    if (out.done) break;
  }
  assert.equal(isComplete(session), true);
  const summary = finishSession(session);
  assert.equal(summary.finished, true);
  assert.equal(summary.steps, outcomes.length);
  assert.equal(summary.correct, 4);
  assert.equal(summary.weak.length, 2);
  assert.equal(summary.finishPoints, 20);
  assert.equal(summary.points, summary.stepPoints + 20);
  assert.ok(summary.activityTypes.length >= 3);
  assert.ok(summary.minutes >= 1);
});

test('a bite that is not finished earns no bite bonus', () => {
  const session = startSession({ facts: PACK, progress: {}, steps: 8, seed: 4 });
  answerStep(session, { correct: true });
  const summary = finishSession(session);
  assert.equal(summary.finished, false);
  assert.equal(summary.finishPoints, 0);
});

test('answerStep after the end is a no-op', () => {
  let session = startSession({ facts: PACK, progress: {}, steps: 6, seed: 6 });
  while (!isComplete(session)) session = answerStep(session, { correct: true }).session;
  const out = answerStep(session, { correct: true });
  assert.equal(out.done, true);
  assert.equal(out.session, session);
  assert.equal(out.step, null);
});

test('a skipped step advances without paying or changing mastery', () => {
  const session = startSession({ facts: PACK, progress: {}, steps: 6, seed: 8 });
  const step = currentStep(session);
  const out = answerStep(session, null, { skipped: true, countsAsMiss: false });
  assert.equal(out.session.index, 1);
  assert.equal(out.session.answers[0].skipped, true);
  assert.equal(out.session.answers[0].points, 0);
  assert.equal(out.session.progress[step.factId].state, 'new', 'nothing written for a free skip');
});

test('one deleted fact does not stop the bite', () => {
  const facts = PACK.slice();
  let session = startSession({ facts, progress: {}, steps: 6, seed: 13 });
  const step = currentStep(session);
  const gone = facts.filter((f) => f.id !== step.factId);
  assert.equal(stepPlayable(step, gone), false);
  const out = answerStep(session, { correct: true }, { facts: gone });
  assert.equal(out.session.index, 1);
});

test('stepVariant hands the screen the exact variant, or a flashcard fallback', () => {
  const session = startSession({ facts: PACK.slice(0, 3), progress: {}, steps: 6, seed: 7 });
  for (const step of session.steps) {
    const found = stepVariant(step, PACK);
    assert.ok(found && found.variant, 'variant for ' + step.type);
    assert.equal(found.variant.factId, step.factId);
  }
  assert.equal(stepVariant({ factId: 'missing', type: 'quiz' }, PACK), null);
});

test('attempts are one doc per bite with every row', () => {
  let session = startSession({ facts: PACK, progress: {}, steps: 6, seed: 12 });
  while (!isComplete(session)) session = answerStep(session, { correct: true }).session;
  const doc = sessionAttempts(session);
  assert.equal(doc.rows.length, 6);
  assert.match(doc.biteId, /^b_/);
  assert.ok(doc.rows.every((row) => row.at && row.type && row.factId));
});

test('the best streak inside a bite is the longest run of right answers', () => {
  const session = { answers: [{ correct: true }, { correct: true }, { correct: false }, { correct: true }, { correct: true }, { correct: true }] };
  assert.equal(biteStreak(session), 3);
});

test('points follow the design table', () => {
  assert.equal(stepReward('quiz'), 10);
  assert.equal(stepReward('blitz'), 10);
  assert.equal(stepReward('flash'), 3);
  assert.equal(stepReward('order'), 15);
  assert.equal(stepReward('teach-back'), 5);
});

test('a bite id is sync safe and unique per start', () => {
  const id = biteId(7, 1700000000000);
  assert.match(id, /^[A-Za-z0-9_-]{1,64}$/);
  assert.notEqual(biteId(7, 1700000000001), id);
});

test('a per camp override changes the bite', () => {
  const settings = {
    ...defaultSettings(),
    campOverrides: { camp_1: { bans: ['quiz', 'true-false', 'swipe', 'blitz', 'sweep'], matrix: defaultSettings().matrix } },
  };
  const session = startSession({ facts: PACK, progress: {}, steps: 6, seed: 21, settings, campId: 'camp_1' });
  assert.equal(session.steps.some((step) => step.type === 'quiz'), false, 'quiz banned by the camp override');
});

function localKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A local clock time in the future, so the triple using it stays a triple. */
function localNoon(year, month, date) {
  return new Date(year, month, date, 9, 0, 0).getTime();
}

function getTypes(session) {
  return [...new Set(session.steps.map((s) => s.type))];
}

void recordAttempt;
