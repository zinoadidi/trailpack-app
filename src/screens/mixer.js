// Mixer settings: auto or manual, the activity type by learning state matrix,
// presets and a per camp override. Every change is saved as the `settings`
// doc (collection `settings`, id `mixer`); the next bite reads it.

import { state, t } from '../app/state.js';
import { h, announce } from '../app/ui.js';
import { loadMixerSettings, saveMixerSettings, loadPlan } from '../study/progress-store.js';
import { presetSettings, defaultSettings, forCamp } from '../study/mixer-settings.js';
import { modeSummary, presetChoices, overrideCamps } from './mixer-logic.js';
import { matrixTable } from './mixer-matrix.js';

export default function mixer() {
  let alive = true;
  let settings = defaultSettings();
  let camps = [];
  let selected = null;
  const root = h('div', { class: 'stack' });
  const body = h('div', { class: 'stack' });
  const status = h('p', { class: 'small mut', 'aria-live': 'polite' });

  async function save(next, note = 'common.saved') {
    settings = next;
    draw();
    try {
      await saveMixerSettings(settings, { store: state.store, sync: state.sync });
      status.textContent = t(note);
    } catch {
      status.textContent = t('mixer.saveFailed');
    }
  }

  function seg(groupLabel, options, current, onPick) {
    const wrap = h('div', { class: 'seg', role: 'group', 'aria-label': groupLabel });
    for (const opt of options) {
      wrap.append(h('button', { type: 'button', 'aria-pressed': String(current === opt.value), onclick: () => onPick(opt.value) }, opt.label));
    }
    return wrap;
  }

  function summaryCard() {
    const summary = modeSummary(settings);
    return h('div', { class: 'panel stack' },
      seg(t('mixer.modeLabel'), [{ value: 'auto', label: t('mixer.modeAuto') }, { value: 'manual', label: t('mixer.modeManual') }], summary.mode, (mode) => save({ ...settings, mode }, 'mixer.saved')),
      h('p', { class: 'small mut' }, summary.mode === 'manual'
        ? t('mixer.manualLine', { on: summary.on, total: summary.total })
        : t('mixer.autoLine', { preset: summary.presetKey ? t(summary.presetKey) : t('mixer.preset.auto') })));
  }

  function presetCard() {
    const list = h('div', { class: 'stack', role: 'radiogroup', 'aria-label': t('mixer.presets'), style: { gap: '8px' } });
    for (const choice of presetChoices()) {
      list.append(h('button', {
        type: 'button',
        class: 'lang',
        role: 'radio',
        'aria-checked': String(settings.preset === choice.name),
        onclick: () => save(presetSettings(choice.name, { conditions: settings.conditions, campOverrides: settings.campOverrides }), 'mixer.saved'),
      }, h('b', {}, t(choice.label)), h('span', { class: 'small mut' }, t(choice.help))));
    }
    return h('section', { class: 'panel stack' }, h('b', {}, t('mixer.presets')), h('p', { class: 'small mut' }, t('mixer.presetsHelp')), list);
  }

  function matrixCard() {
    const card = h('section', { class: 'panel stack' }, h('b', {}, t('mixer.matrixTitle')));
    if (selected) {
      const camp = camps.find((item) => item.id === selected);
      card.append(h('div', { class: 'row' },
        h('small', {}, t('mixer.overrideFor', { camp: camp ? camp.title : selected })),
        h('button', { type: 'button', class: 'btn sm', onclick: () => { selected = null; draw(); } }, t('mixer.overrideStop'))));
    }
    card.append(h('p', { class: 'small mut' }, selected ? t('mixer.overrideHelp') : t('mixer.matrixHelp')));
    const view = selected ? forCamp(settings, selected) : settings;
    card.append(matrixTable(view, (next) => {
      if (!selected) {
        save({ ...next, mode: 'manual' }, 'mixer.saved');
        return;
      }
      const matrix = next.matrix || view.matrix;
      save({ ...settings, campOverrides: { ...(settings.campOverrides || {}), [selected]: { matrix, mode: 'manual', preset: 'custom' } } }, 'mixer.saved');
    }, t));
    card.append(h('button', { type: 'button', class: 'btn sm g', onclick: () => save(presetSettings(settings.preset || 'auto', { conditions: settings.conditions, campOverrides: settings.campOverrides }), 'mixer.resetDone') }, t('mixer.reset')));
    return card;
  }

  function pinRow(which, title, help) {
    const row = h('div', { class: 'row wrap', style: { gap: '6px' } });
    for (const choice of presetChoices()) void choice;
    for (const type of ['quiz', 'flash', 'cloze', 'order', 'match', 'listen', 'blitz', 'sweep', 'spot-mistake', 'teach-back', 'voice', 'true-false']) {
      const on = (settings[which] || []).includes(type);
      const label = 'study.type.' + type.replace(/-(.)/g, (_, c) => c.toUpperCase());
      row.append(h('button', {
        type: 'button',
        class: 'chip' + (on ? ' t' : ''),
        'aria-pressed': String(on),
        onclick: () => {
          const list = settings[which] || [];
          save({ ...settings, [which]: on ? list.filter((x) => x !== type) : [...list, type] }, 'mixer.saved');
        },
      }, t(label)));
    }
    return h('div', { class: 'stack', style: { gap: '6px' } }, h('b', { class: 'small' }, title), h('p', { class: 'small mut' }, help), row);
  }

  function campsCard() {
    if (!camps.length) return null;
    const list = h('div', { class: 'stack', role: 'list', style: { gap: '8px' } });
    for (const camp of camps) {
      const own = settings.campOverrides && settings.campOverrides[camp.id];
      list.append(h('div', { class: 'row' },
        h('span', {}, t('trail.campTitle', { number: camp.index + 1, title: camp.title })),
        h('span', { class: 'row', style: { gap: '6px' } },
          own ? h('span', { class: 'chip o' }, t('mixer.overrideOn')) : h('span', { class: 'chip' }, t('mixer.inherit')),
          h('button', { type: 'button', class: 'btn sm', onclick: () => { selected = camp.id; draw(); } }, t('mixer.overrideEdit')),
          own ? h('button', { type: 'button', class: 'btn sm danger', onclick: () => {
            const next = { ...(settings.campOverrides || {}) };
            delete next[camp.id];
            save({ ...settings, campOverrides: next }, 'mixer.overrideRemoved');
          } }, t('mixer.overrideRemove')) : null)));
    }
    return h('section', { class: 'panel stack' }, h('b', {}, t('mixer.overrideTitle')), h('p', { class: 'small mut' }, t('mixer.overrideHelp')), list);
  }

  function draw() {
    body.replaceChildren(summaryCard(), presetCard(), matrixCard(), h('section', { class: 'panel stack' }, pinRow('pins', t('mixer.pins'), t('mixer.pinsHelp')), pinRow('bans', t('mixer.bans'), t('mixer.bansHelp'))), ...(campsCard() ? [campsCard()] : []), status);
  }

  async function boot() {
    try {
      settings = await loadMixerSettings(state.store);
      const active = await state.store.get('meta', 'active-pack-id');
      if (active && active.value) {
        const plan = await loadPlan(active.value, state.store);
        camps = overrideCamps(plan).map((camp) => ({ ...camp, hasOverride: Boolean(settings.campOverrides && settings.campOverrides[camp.id]) }));
      }
    } catch {
      settings = defaultSettings();
    }
    if (!alive) return;
    draw();
    announce(t('mixer.title'));
  }

  root.append(
    h('div', { class: 'row' }, h('h1', { class: 'h1 disp' }, t('mixer.title')), h('a', { class: 'btn sm', href: '#/' }, t('game.bite.backToTrail'))),
    h('p', { class: 'mut' }, t('mixer.subtitle')),
    body,
  );
  boot();

  return {
    el: root,
    title: t('mixer.title'),
    destroy() {
      alive = false;
    },
  };
}
