import test from 'node:test';
import assert from 'node:assert/strict';

import { CERT_HEIGHT, CERT_WIDTH, canIssueCertificate, certificateData, certificateFileName, certificateLines, daysTaken, drawCertificate, roundRect } from '../src/game/certificate.js';
import { CONFETTI_COUNT, CONFETTI_COUNT_REDUCED, biteComplete, celebrationLine, confettiPlan } from '../src/game/bite.js';

const TRAIL = {
  packTitle: 'Intro to project management',
  learnerName: 'Sam',
  startedAt: '2026-01-01',
  finishedAt: '2026-01-31',
  points: 3100,
  lensCount: 3,
  campCount: 5,
};

test('certificate data carries pack, dates, days, points and Lens count', () => {
  const data = certificateData(TRAIL);
  assert.equal(data.packTitle, 'Intro to project management');
  assert.equal(data.startedAt, '2026-01-01');
  assert.equal(data.finishedAt, '2026-01-31');
  assert.equal(data.days, 31);
  assert.equal(data.points, 3100);
  assert.equal(data.lensCount, 3);
  assert.equal(data.campCount, 5);
  assert.equal(data.v, 1);
});

test('certificate data is safe with missing or junk values', () => {
  const data = certificateData({ points: -10, lensCount: 0, finishedAt: '2026-02-02' });
  assert.equal(data.points, 0);
  assert.equal(data.lensCount, 1);
  assert.equal(data.packTitle, 'Untitled pack');
  assert.equal(data.learnerName, '');
  assert.equal(data.campCount, 0);
  assert.equal(certificateData({}).startedAt, null);
  assert.equal(String(certificateData({ packTitle: 'x'.repeat(500) }).packTitle).length, 90);
});

test('days taken counts both ends and survives a bad date', () => {
  assert.equal(daysTaken('2026-01-01', '2026-01-01'), 1);
  assert.equal(daysTaken('2026-01-01', '2026-01-08'), 8);
  assert.equal(daysTaken(null, '2026-01-08'), 0);
  assert.equal(daysTaken('nonsense', '2026-01-08'), 0);
});

test('the layout has the design fields, inside the canvas', () => {
  const data = certificateData(TRAIL);
  const lines = certificateLines(data);
  const keys = lines.map((line) => line.key);
  for (const key of ['title', 'name', 'pack', 'dates', 'points', 'camps', 'lenses', 'foot']) assert.ok(keys.includes(key), key);
  for (const line of lines) {
    assert.ok(line.x >= 0 && line.x <= CERT_WIDTH, line.key + ' x');
    assert.ok(line.y >= 0 && line.y <= CERT_HEIGHT, line.key + ' y');
    assert.equal(line.align, 'center');
  }
  assert.ok(lines.find((l) => l.key === 'pack').text.includes('Intro to project management'));
  assert.ok(lines.find((l) => l.key === 'points').text.includes('3100'));
  assert.ok(lines.find((l) => l.key === 'dates').text.includes('31 days'));
});

test('a finished trail can issue a certificate, an unfinished one cannot', () => {
  assert.equal(canIssueCertificate({ camps: [{ state: 'summited' }, { state: 'summited' }], mockPassed: true }), true);
  assert.equal(canIssueCertificate({ camps: [{ state: 'summited' }, { state: 'open' }], mockPassed: true }), false);
  assert.equal(canIssueCertificate({ camps: [{ state: 'summited' }], mockPassed: false }), false);
  assert.equal(canIssueCertificate({ summit: true }), true);
  assert.equal(canIssueCertificate({}), false);
});

test('the certificate file name is a safe png name', () => {
  assert.equal(certificateFileName({ packTitle: 'Intro to project management' }), 'intro-to-project-management-certificate.png');
  assert.equal(certificateFileName({}), 'trailpack-certificate.png');
});

test('drawCertificate paints with a fake context and needs no DOM', () => {
  const calls = [];
  const ctx = {
    save() {},
    restore() {},
    clearRect() {},
    fillRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    closePath() {},
    fill() {},
    stroke() {},
    fillText(text, x, y) {
      calls.push({ text, x, y, colour: this.fillStyle });
    },
  };
  const palette = { page: 'p', surface: 's', text: 't', muted: 'm', spark: 'k', volt: 'v', summit: 'u', orchid: 'o' };
  const lines = drawCertificate(ctx, certificateData(TRAIL), palette);
  assert.equal(calls.length, lines.length);
  assert.ok(calls.every((call) => typeof call.text === 'string'));
  assert.ok(calls.some((call) => call.colour === 'k'), 'the learner name uses the spark colour');
});

test('roundRect builds a path without a native roundRect', () => {
  let ops = 0;
  const ctx = { beginPath() { ops += 1; }, moveTo() {}, lineTo() {}, quadraticCurveTo() { ops += 1; }, closePath() {}, };
  roundRect(ctx, 0, 0, 100, 50, 10);
  assert.equal(ops, 5);
});

test('a bite summary adds the finish points and the variety bonus', () => {
  const plain = biteComplete({ pointsBefore: 100, stepPoints: 40, activityTypes: ['quiz', 'flash'] });
  assert.equal(plain.gained, 60);
  assert.equal(plain.pointsAfter, 160);
  assert.equal(plain.variety, false);
  assert.equal(plain.bonus, 0);
  const varied = biteComplete({ pointsBefore: 100, stepPoints: 40, activityTypes: ['quiz', 'flash', 'match', 'order'] });
  assert.equal(varied.variety, true);
  assert.equal(varied.varietyTypes, 4);
  assert.equal(varied.bonus, 6);
  assert.equal(varied.gained, 66);
});

test('a bite that crosses a level threshold reports the level up', () => {
  const summary = biteComplete({ pointsBefore: 280, stepPoints: 15, activityTypes: ['quiz'], factCount: 60, kind: 'interview' });
  assert.equal(summary.levelUp.from, 1);
  assert.equal(summary.levelUp.to, 2);
  assert.equal(summary.levelUp.name, 'senior');
  const calm = biteComplete({ pointsBefore: 100, stepPoints: 15 });
  assert.equal(calm.levelUp, null);
});

test('reduced motion drops the confetti to zero, everything else stays', () => {
  const moving = biteComplete({ stepPoints: 20, activityTypes: ['quiz', 'flash', 'match', 'order'], reducedMotion: false });
  assert.equal(moving.confetti, CONFETTI_COUNT);
  assert.equal(moving.plan.length, CONFETTI_COUNT);
  const still = biteComplete({ stepPoints: 20, activityTypes: ['quiz', 'flash', 'match', 'order'], reducedMotion: true });
  assert.equal(still.confetti, CONFETTI_COUNT_REDUCED);
  assert.deepEqual(still.plan, []);
  assert.equal(still.gained, moving.gained, 'the reward does not change with the animation');
});

test('the confetti plan is deterministic and bounded', () => {
  const a = confettiPlan(12);
  const b = confettiPlan(12);
  assert.deepEqual(a, b);
  assert.equal(a.length, 12);
  assert.equal(confettiPlan(9999).length, 200, 'never a runaway loop');
  assert.equal(confettiPlan(-3).length, 0);
  for (const piece of a) {
    assert.ok(['spark', 'volt', 'summit', 'mint', 'orchid', 'sky'].includes(piece.colour));
    assert.ok(piece.delay >= 0 && piece.delay < 400);
    assert.ok(piece.drift >= -50 && piece.drift < 50);
  }
});

test('the celebration line names a level, a camp or a plain bite', () => {
  const level = celebrationLine(biteComplete({ pointsBefore: 280, stepPoints: 15, factCount: 60 }));
  assert.equal(level.kind, 'level');
  assert.equal(level.key, 'game.levelUpLine');
  assert.equal(level.values.level, 2);
  assert.ok(level.values.name.startsWith('game.level.'), 'the level name is a key too');
  assert.equal(celebrationLine({ campSummited: 'Camp 2' }).key, 'game.campSummitLine');
  assert.equal(celebrationLine(biteComplete({ stepPoints: 5 })).key, 'game.biteDoneLine');
  assert.equal(celebrationLine(null).kind, 'none');
});

test('the bite summary never goes below zero with junk input', () => {
  const summary = biteComplete({ pointsBefore: -50, stepPoints: 'x', activityTypes: null });
  assert.equal(summary.pointsBefore, 0);
  assert.equal(summary.gained, 20);
  assert.equal(summary.pointsAfter, 20);
});
