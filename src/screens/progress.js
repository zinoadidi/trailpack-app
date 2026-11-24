// Progress (#/progress): points and level, both streaks, the Shortcuts wallet,
// mastery per topic, the readiness number from the Trail, the full achievement
// grid and the Lens bar. Read only apart from the Shortcut and Lens actions.

import { state, t } from '../app/state.js';
import { h, toast, announce } from '../app/ui.js';
import { dayKey } from '../game/streaks.js';
import { levelFor } from '../game/levels.js';
import { shortcutsLeft, spendShortcut } from '../game/profile.js';
import { WALLET, canSpend } from '../game/shortcuts.js';
import { emptyLens } from '../game/lens.js';
import { achievementGrid, achievementsSummaryLine, streakRow } from './game-widgets.js';
import { progressBar, readProfile, runProfileAction } from '../game/screen-helpers.js';
import { lensBar, lensChip, lensPicker, lensState } from './lens-bar.js';
import { masterProgress, readStudySnapshot } from './progress-data.js';

/** One generated item per activity kind, so the rebuild estimate is real. */
const LENS_ITEMS = ['flash', 'quiz', 'oral', 'task', 'guide', 'cheat', 'anki', 'audio'].map((kind) => ({ id: 'est-' + kind, kind }));

export default function progress() {
  const root = h('div', { class: 'stack' });
  const body = h('div', { class: 'stack' });
  root.append(h('div', { class: 'row' }, h('h1', { class: 'h1' }, t('game.profileTitle'))), body);

  async function render() {
    let profile;
    let snapshot;
    try {
      [profile, snapshot] = await Promise.all([readProfile(), readStudySnapshot()]);
    } catch {
      body.replaceChildren(h('div', { class: 'panel stack' }, h('p', { class: 'mut' }, t('game.loadFailed'))));
      return;
    }
    const { lens, lenses } = await lensState(emptyLens());
    const pack = snapshot.pack || {};
    const level = levelFor(profile.points, { kind: pack.kind, factCount: snapshot.factCount });
    const today = dayKey(Date.now());
    const shortcuts = shortcutsLeft(profile);

    body.replaceChildren(
      h(
        'section',
        { class: 'panel stack' },
        h('div', { class: 'row' }, h('b', {}, t('game.levelLine', { level: level.level, name: t('game.level.names.' + level.name) })), h('span', { class: 'chip v' }, t('game.points', { count: level.points }))),
        progressBar(level.progress * 100, t('game.levelToNext', { count: level.toNext ?? 0 })),
        h('p', { class: 'mut small' }, level.toNext === null ? t('game.levelMax') : t('game.levelToNext', { count: level.toNext })),
        lens.difficulty === 'hard' ? h('p', { class: 'mut small' }, t('lens.hardBonus')) : null,
      ),
      h('section', { class: 'panel stack' }, h('div', { class: 'row' }, h('b', {}, t('game.streak.answer')), lensChip(lens)), streakRow(profile, today)),
      readinessSection(snapshot),
      masterySection(snapshot),
      shortcutSection(profile, shortcuts),
      h('section', { class: 'panel stack' }, lensPicker(lenses, lens, { onChange: render }), lensBar(lens, { items: LENS_ITEMS, onChange: render })),
      h('section', { class: 'panel stack' }, h('h2', { class: 'h', style: { fontSize: '17px' } }, t('game.achievements') + ' \u00B7 ' + achievementsSummaryLine(profile.achievements)), achievementGrid(profile.achievements)),
    );
  }

  function readinessSection(snapshot) {
    if (!snapshot.factCount) {
      return h('section', { class: 'panel stack' }, h('b', {}, t('wired.readiness')), h('p', { class: 'mut small' }, t('wired.noMastery')));
    }
    const ready = snapshot.readiness;
    return h(
      'section',
      { class: 'panel stack' },
      h('div', { class: 'row' }, h('b', {}, t('wired.readiness')), h('span', { class: 'chip t' }, t('wired.readinessValue', { score: ready.score }))),
      progressBar(ready.score, t('wired.readinessA11y', { score: ready.score })),
      h('p', { class: 'mut small' }, snapshot.plan && snapshot.plan.camps && snapshot.plan.camps.length ? t('wired.readinessTrail') : t('wired.readinessNoTrail')),
    );
  }

  function masterySection(snapshot) {
    if (!snapshot.factCount) {
      return h('section', { class: 'panel stack' }, h('b', {}, t('wired.mastery')), h('p', { class: 'mut small' }, t('wired.noMastery')));
    }
    const rows = masterProgress(snapshot);
    return h(
      'section',
      { class: 'panel stack' },
      h('div', { class: 'row' }, h('b', {}, t('wired.mastery')), h('span', { class: 'mut small' }, t('wired.masteredTotal', { done: snapshot.summary.mastered, total: snapshot.summary.total }))),
      ...rows.map((row) =>
        h(
          'div',
          { class: 'stack', style: { gap: '4px' } },
          h('div', { class: 'row' }, h('span', { class: 'small' }, row.title), h('span', { class: 'mut small' }, t('wired.masteredTotal', { done: row.mastered, total: row.total }))),
          progressBar(row.percent, t('wired.topicA11y', { title: row.title, done: row.mastered, total: row.total })),
        ),
      ),
    );
  }

  function shortcutSection(profile, shortcuts) {
    const used = Object.values(profile.wallet.used || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
    const demoCamp = 'camp-1';
    const check = canSpend(profile.wallet, { campId: demoCamp, kind: 'step' });
    const button = h(
      'button',
      {
        class: 'btn sm',
        type: 'button',
        disabled: !check.ok,
        onclick: async () => {
          const { reason } = await runProfileAction((current) => spendShortcut(current, { campId: demoCamp, kind: 'step', itemId: 'next-step', day: dayKey(Date.now()) }));
          toast(reason ? t(reason === 'checkpoint' ? 'game.shortcutsCheckpoint' : reason === 'camp' ? 'game.shortcutsCampLimit' : 'game.shortcutsEmpty') : t('game.shortcutsSkipped'));
          render();
        },
      },
      t('game.shortcutsUse'),
    );
    return h(
      'section',
      { class: 'panel stack' },
      h('div', { class: 'row' }, h('h2', { class: 'h', style: { fontSize: '17px' } }, t('game.shortcuts')), h('span', { class: 'mut small' }, t('game.streak.best', { count: WALLET.max }))),
      h('div', { class: 'row wrap', style: { gap: '8px' } }, h('span', { class: 'chip a' }, t('game.shortcutsLeft', { count: shortcuts })), h('span', { class: 'mut small' }, t('game.shortcutsHelp'))),
      h('div', { class: 'row' }, h('span', { class: 'mut small' }, String(used) + ' / ' + WALLET.perCamp), button),
    );
  }

  return {
    el: root,
    title: t('game.profileTitle'),
    async mount() {
      try {
        await render();
        announce(t('a11y.gameSummary'));
      } catch {
        body.replaceChildren(h('div', { class: 'panel' }, h('p', { class: 'mut' }, t('game.loadFailed'))));
      }
    },
  };
}
