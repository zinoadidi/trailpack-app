// Small DOM widgets shared by the M4 screens. Every colour is a class or a CSS
// variable, never a literal, and every string arrives already translated.

import { t } from '../app/state.js';
import { h } from '../app/ui.js';
import { achievementList, achievementSummary } from '../game/achievements.js';
import { streakSummary } from '../game/streaks.js';

/** "12 of 28" for the achievements heading. */
export function achievementsSummaryLine(earned) {
  const summary = achievementSummary(earned);
  return t('game.achievementsCount', { earned: summary.earned, total: summary.total });
}

/** One badge: a token coloured ring, the title and the help line. */
export function badge(entry) {
  const title = t('game.achievement.' + entry.id);
  const help = t('game.achievement.' + entry.id + '.help');
  const node = h(
    'li',
    { class: 'badge' + (entry.earned ? ' on' : ''), 'aria-label': entry.earned ? title : title + ', ' + t('game.achievementsLocked') },
    h('span', { class: 'dot', 'aria-hidden': 'true' }),
    h('span', { class: 'txt' }, h('b', {}, title), h('span', { class: 'mut small' }, entry.earned && entry.at ? t('game.achievementsEarnedOn', { when: new Date(entry.at) }) : help)),
  );
  return node;
}

/** The full grid, grouped by nothing (design order reads well on its own). */
export function achievementGrid(earned) {
  return h('ul', { class: 'badges' }, ...achievementList(earned).map(badge));
}

/** Flame row: day and plan streak, with a calm "resting" line instead of guilt. */
export function streakRow(profile, today) {
  const summary = streakSummary(profile, today);
  const row = h('div', { class: 'streaks' });
  for (const [key, label] of [
    ['day', t('game.streak.day')],
    ['plan', t('game.streak.plan')],
  ]) {
    const line = summary[key];
    row.append(
      h(
        'div',
        { class: 'streak' + (line.alive ? ' on' : '') },
        h('span', { class: 'flame', 'aria-hidden': 'true' }, '\u25B2'),
        h('span', {}, h('b', {}, t('game.streak.days', { count: line.current })), h('span', { class: 'mut small', style: { display: 'block' } }, label)),
        h('span', { class: 'mut small' }, line.alive ? t('game.streak.best', { count: line.best }) : t('game.streak.resting')),
      ),
    );
  }
  return row;
}

/** One row of a key value list. */
export function kvRow(label, value) {
  return [h('dt', {}, label), h('dd', {}, value)];
}
