// Bite complete (#/bite): the celebration screen from design 2.7. Points, the
// variety bonus, a level up, new badges, the two streaks and confetti that is
// skipped when the device asks for less motion.
//
// It is driven by the same pure `biteComplete` a test covers, and it is a real
// screen: a bite hands it `{stepPoints, activityTypes, minutes}` through the
// session state, and a demo button fills it so the flow can be walked today.

import { state, t } from '../app/state.js';
import { h, announce } from '../app/ui.js';
import { biteComplete } from '../game/bite.js';
import { dayBucket } from '../game/profile.js';
import { dayKey } from '../game/streaks.js';
import { prefersReducedMotion, readProfile } from '../game/screen-helpers.js';
import { recordBite, recordFinish, finishPoints, sound } from '../game/wire-run.js';
import { sfxFor } from '../game/wire.js';
import { navigate } from '../app/router.js';

const DEMO_BITE = { stepPoints: 45, activityTypes: ['flash', 'quiz', 'match', 'order'], minutes: 4, demo: true };

/** Levels crossed by a bite, from the pure summary (no profile round trip needed). */
export function finishLevels(summary) {
  return summary && summary.levelUp ? Math.max(1, summary.levelUp.to - summary.levelUp.from) : 0;
}

export default function bite() {
  const root = h('div', { class: 'stack' });
  const input = state.pendingBite || DEMO_BITE;

  async function build() {
    const profile = await readProfile();
    const level = state.pendingLevel || {};
    const today = dayKey(Date.now());
    const bucket = dayBucket(profile, today);
    const summary = biteComplete({
      ...input,
      // The profile already holds the steps and the finish bonus: the screen
      // reads the level from the real total and only adds the variety bonus.
      pointsBefore: Math.max(0, profile.points - finishPoints(input.activityTypes)),
      kind: level.kind,
      factCount: level.factCount,
      dayStreak: profile.dayStreak.current,
      planStreak: profile.planStreak.current,
      bestAnswerStreak: profile.bestAnswerStreak || 0,
      biteCountToday: bucket.bites,
      newAchievements: input.newAchievements || [],
      reducedMotion: prefersReducedMotion(),
    });

    const confetti = h('div', { class: 'confetti', 'aria-hidden': 'true' });
    for (const piece of summary.plan) {
      confetti.append(
        h('i', {
          class: 'piece c-' + piece.colour,
          style: { '--angle': piece.angle + 'deg', '--delay': piece.delay + 'ms', '--drift': piece.drift + 'px' },
        }),
      );
    }

    root.replaceChildren(
      confetti,
      h('div', { class: 'row' }, h('h1', { class: 'h1' }, t('game.bite.title')), h('span', { class: 'chip v' }, t('game.bite.points', { points: summary.gained }))),
      h(
        'section',
        { class: 'panel stack' },
        h('div', { class: 'row' }, h('b', {}, t('game.bite.minutesLine', { count: summary.minutes })), h('span', { class: 'mut small' }, t('game.bite.varietyTypes', { count: summary.varietyTypes }))),
        summary.variety ? h('span', { class: 'chip a' }, t('game.bite.variety')) : null,
        h('div', { class: 'row' }, h('span', {}, t('game.levelLine', { level: summary.level.level, name: t('game.level.names.' + summary.level.name) })), h('span', { class: 'mut small' }, t('game.points', { count: summary.pointsAfter }))),
        summary.levelUp ? h('div', { class: 'notice ok' }, h('p', {}, t('game.levelUpLine', { level: summary.levelUp.to, name: t('game.level.names.' + summary.levelUp.name) }))) : null,
      ),
      h(
        'section',
        { class: 'panel stack' },
        h('div', { class: 'row' }, h('b', {}, t('game.streak.day')), h('span', { class: 'mut' }, t('game.streak.days', { count: summary.streaks.day }))),
        h('div', { class: 'row' }, h('b', {}, t('game.streak.plan')), h('span', { class: 'mut' }, t('game.streak.days', { count: summary.streaks.plan }))),
      ),
      summary.achievements.length
        ? h('section', { class: 'panel stack' }, h('b', {}, t('game.achievementsNew', { count: summary.achievements.length })), ...summary.achievements.map((id) => h('div', { class: 'row' }, h('span', {}, t('game.achievement.' + id)), h('span', { class: 'mut small' }, t('game.achievement.' + id + '.help')))))
        : null,
      summary.plan.length === 0 ? h('p', { class: 'mut small' }, t('game.bite.reduceMotion')) : null,
      h(
        'div',
        { class: 'row stack-mobile' },
        h('button', { class: 'btn p', type: 'button', onclick: () => navigate('/progress') }, t('game.bite.viewProgress')),
        h('button', { class: 'btn', type: 'button', onclick: () => navigate('/') }, t('game.bite.backToTrail')),
      ),
    );
    announce(t('game.levelUpLine', { level: summary.level.level, name: t('game.level.names.' + summary.level.name) }));
  }

  build();

  return {
    el: root,
    title: t('game.bite.title'),
    async mount() {
      // The study runner pays a real bite before routing here, so a run with
      // a session (`session`) that is not marked recorded must mean a resumed
      // bite: pay what is unpaid, then show the screen once.
      if (state.pendingBite && !state.pendingBite.recorded && state.pendingBite.session) {
        const bite = state.pendingBite;
        const session = bite.session;
        state.pendingBite = { ...bite, recorded: true };
        await recordBite({ session, plan: bite.plan });
        const paid = await recordFinish({ points: finishPoints(bite.activityTypes), activityTypes: bite.activityTypes, session, plan: bite.plan });
        await build();
        if (paid && paid.unlocked && paid.unlocked.length) sound(sfxFor('badge'));
      }
    },
    destroy() {
      state.pendingBite = null;
    },
  };
}

/** Used by a finish button elsewhere to hand a bite to this screen. */
export function finishBite({ stepPoints, activityTypes, minutes, kind, factCount }) {
  state.pendingBite = { stepPoints, activityTypes, minutes, kind, factCount };
  navigate('/bite');
}


