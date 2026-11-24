// Trail home: the camps as a path, the open camp, gates at 70%, the Daily
// Walk card, the readiness score and deadline mode. The empty state (no pack
// or no plan yet) stays, with the way to start. Numbers come from
// trail-home-logic.js; this file only loads, draws and saves.

import { state, t, subscribe } from '../app/state.js';
import { h, mark, announce } from '../app/ui.js';
import { progressBar } from '../game/screen-helpers.js';
import { listPacks, loadFacts, loadPackBundle } from '../study/store.js';
import { planCamps } from '../study/trail.js';
import { normalisePlan } from '../study/trail-normalise.js';
import { loadPlan, loadProgress, savePlan, withBlank, loadAttempts } from '../study/progress-store.js';
import { trailHome } from './trail-home-logic.js';
import { ring } from './trail-home-widgets.js';
import { lensChip } from './lens-bar.js';
import { parseDeadline, deadlineInput } from './trail-deadline.js';
import { emptyHome, ctaHref } from './trail-empty.js';
import { biteMinutes, getSprintDays, setSprintDays, clampSprintDays, SPRINT_RANGE } from './trail-sprint.js';

/** A pack with no trail yet gets one from its topics and facts (device side). */
async function ensurePlan(packId) {
  const existing = await loadPlan(packId, state.store);
  if (existing && existing.camps && existing.camps.length) return existing;
  const bundle = await loadPackBundle(packId, state.store);
  if (!bundle || !bundle.facts.length) return existing;
  const camps = planCamps(bundle.topics, bundle.facts, { packId });
  if (!camps.length) return existing;
  const plan = normalisePlan({ ...existing, packId, camps, startedAt: new Date().toISOString(), openIndex: 0 }, packId);
  try {
    await savePlan(plan, { store: state.store, sync: state.sync });
  } catch {
    /* a device without a writable store still shows the plan */
  }
  return plan;
}

/** Minutes and steps done today, from the newest bite finish time. */
export async function doneToday(attempts, now = Date.now()) {
  const day = new Date(now).toDateString();
  let steps = 0;
  let minutes = 0;
  let last = null;
  for (const doc of attempts || []) {
    const at = Number(doc.endedAt || doc.startedAt || 0);
    if (!at) continue;
    if (!last || at > last) last = at;
    if (new Date(at).toDateString() !== day) continue;
    steps += (doc.rows || []).length;
    minutes += biteMinutes(doc);
  }
  return { steps, minutes: Math.round(minutes), lastStudyAt: last ? new Date(last).toISOString() : null };
}

/** The date field: set a deadline, or move it, saved on the plan. */
function deadlineField(plan, deadline) {
  const input = h('input', {
    class: 'input',
    type: 'date',
    'aria-label': t('trailhome.deadlineField'),
    value: deadlineInput(plan && plan.deadline),
  });
  const note = h('span', { class: 'small mut', 'aria-live': 'polite' });
  const save = h('button', {
    type: 'button',
    class: 'btn sm',
    onclick: async () => {
      const parsed = parseDeadline(input.value);
      if (!parsed.ok) {
        note.textContent = t('trailhome.deadlineBad');
        announce(note.textContent);
        return;
      }
      try {
        await savePlan({ ...plan, deadline: parsed.iso }, { store: state.store, sync: state.sync });
        note.textContent = t('trailhome.deadlineSaved');
        announce(note.textContent);
      } catch {
        note.textContent = t('trailhome.deadlineFailed');
      }
    },
  }, t('trail.deadlineSet'));
  const sprint = h('input', {
    class: 'input',
    type: 'number',
    inputmode: 'numeric',
    min: String(SPRINT_RANGE.min),
    max: String(SPRINT_RANGE.max),
    style: { width: '5em' },
    'aria-label': t('trailhome.sprintField'),
    value: String(getSprintDays()),
    onchange: () => {
      sprint.value = String(setSprintDays(sprint.value));
      note.textContent = t('trailhome.sprintSaved', { days: sprint.value });
      announce(note.textContent);
    },
  });
  return h('div', { class: 'stack', style: { gap: '6px' } }, h('div', { class: 'row wrap', style: { gap: '8px' } }, input, save), h('label', { class: 'row small mut', style: { gap: '8px' } }, t('trailhome.sprintField'), sprint, t('trailhome.sprintUnit')), h('p', { class: 'small mut' }, t('trailhome.sprintHelp')), note);
}

function campPath(home, onOpen) {
  const list = h('ol', { class: 'campath', 'aria-label': t('trailhome.pathLabel') });
  for (const camp of home.camps) {
    const chip = h('span', { class: 'chip ' + (camp.passed ? 'm' : camp.current ? 'a' : 'v') }, t('trail.state.' + camp.label));
    const item = h(
      'li',
      { class: 'camp ' + camp.state },
      h('button', {
        type: 'button',
        class: 'campdot',
        'aria-label': t('trailhome.campLabel', { number: camp.index + 1, title: camp.title, state: t('trail.state.' + camp.label) }),
        disabled: !camp.reachable && !camp.current,
        onclick: () => onOpen(camp),
      }, String(camp.index + 1)),
      h('div', { class: 'campbody' }, h('div', { class: 'row' }, h('b', {}, t('trail.campTitle', { number: camp.index + 1, title: camp.title })), chip), h('div', { class: 'small mut' }, camp.gateText ? t('trail.gateScore', { score: camp.gateText.score }) : t('trail.gateLine', { percent: camp.gate }))),
    );
    list.append(item);
  }
  return list;
}

export default function trail() {
  let alive = true;
  let refresh = null;
  const root = h('div', { class: 'stack' });
  const body = h('div', { class: 'stack' });

  let plan = null;
  let packCount = 0;
  let factCount = 0;

  function emptyState(message, kind) {
    body.replaceChildren(
      h('div', { class: 'panel stack' },
        h('p', { class: 'mut' }, message),
        h('div', { class: 'row wrap', style: { gap: '8px' } },
          h('a', { class: 'btn p', href: '#/learn' }, t('discover.learn')),
          h('a', { class: 'btn p', href: ctaHref(kind) }, t('trail.emptyCta')),
          h('a', { class: 'btn', href: '#/mixer' }, t('mixer.title')))),
    );
  }

  async function ensureActiveLens() {
    try {
      const { loadActiveLens } = await import('../game/store.js');
      await loadActiveLens(state.store);
    } catch {
      /* no Lens yet: nothing to name */
    }
  }

  function draw(home) {
    if (!home.hasPlan) return emptyState(t('trail.empty'), emptyHome(packCount, plan, factCount).kind);
    const cards = [];
    if (home.complete) cards.push(h('div', { class: 'notice ok' }, h('span', {}, t('trail.complete')), h('a', { class: 'btn sm', href: '#/progress' }, t('trail.certificate'))));
    // Read only: the Trail names the Lens every fact here is shown through.
    const lens = state.activeLens;
    if (lens && lens.title) cards.push(h('div', { class: 'row wrap', style: { gap: '8px' } }, lensChip(lens), h('a', { class: 'btn sm', href: '#/progress' }, t('wired.changeLens'))));
    cards.push(h('div', { class: 'panel stack' },
      h('div', { class: 'row' }, h('b', {}, t('trail.dailyWalk')), h('span', { class: 'chip v' }, home.walk.doneLine || '')),
      progressBar(home.walk.percent, home.walk.doneLine || t('trail.dailyWalk')),
      h('div', { class: 'row small mut' }, h('span', {}, home.walk.stepsLine || ''), h('span', {}, home.walk.dueLine || '')),
      h('p', { class: 'small' }, home.walk.met ? t('trail.dailyWalkMet') : t('trailhome.walkNext', { remaining: home.walk.remaining })),
      h('div', { class: 'row wrap', style: { gap: '8px' } },
        h('a', { class: 'btn p', href: '#/study' }, t('study.startBite')),
        home.current ? h('button', { type: 'button', class: 'btn', onclick: () => openCamp(home.current.id) }, t('trail.studyCamp')) : null,
        h('a', { class: 'btn', href: '#/practice' }, t('act2.practiceTitle')))));
    cards.push(h('div', { class: 'panel stack' },
      h('div', { class: 'row' }, h('b', {}, t('trail.readiness')), ring(home.readiness.score, t('trail.readinessLine', { score: home.readiness.score }))),
      progressBar(home.readiness.score, t('trail.readiness')),
      h('div', { class: 'row small mut wrap', style: { gap: '10px' } },
        h('span', {}, t('trail.readinessRecall') + ' ' + home.readiness.parts.recall + '%'),
        h('span', {}, t('trail.readinessCheckpoints') + ' ' + home.readiness.parts.checkpoints + '%'),
        h('span', {}, t('trail.readinessCamps') + ' ' + home.readiness.parts.camps + '%')),
      h('div', { class: 'row' }, h('small', { class: 'mut' }, home.mastery.line || ''), h('a', { class: 'btn sm', href: '#/mixer' }, t('mixer.title')))));
    const deadline = home.deadline;
    cards.push(h('div', { class: 'panel stack' },
      h('div', { class: 'row' }, h('b', {}, t('trail.deadline')),
        deadline.has ? h('span', { class: 'chip ' + (deadline.countdown.overdue ? 'e' : deadline.sprint ? 'a' : 'k') }, deadline.countdown.overdue ? t('trailhome.overdue') : deadline.countdown.text) : h('span', { class: 'chip' }, t('trail.deadlineNone'))),
      deadline.has ? h('p', { class: 'small mut' }, deadline.sprint ? t('trail.deadlineSprint') : t('trail.deadlineMode')) : h('p', { class: 'small mut' }, t('trailhome.deadlineHelp')),
      deadline.line ? h('div', { class: 'notice warn' }, deadline.line) : null,
      deadlineField(plan, deadline)));
    cards.push(h('div', { class: 'panel stack' }, h('b', {}, t('trailhome.pathLabel')), campPath(home, (camp) => openCamp(camp.id))));
    body.replaceChildren(...cards);
  }

  function openCamp(campId) {
    const url = '#/study?camp=' + encodeURIComponent(campId);
    location.hash = url;
  }

  async function boot() {
    let progress = {};
    let meta = { steps: 0, minutes: 0, lastStudyAt: null };
    try {
      const active = await state.store.get('meta', 'active-pack-id');
      let packId = (active && active.value) || null;
      if (!packId) {
        const packs = await listPacks(state.store);
        packCount = packs.length;
        packId = packs.length ? packs[0].id : null;
      } else {
        packCount = (await listPacks(state.store)).length || 1;
      }
      if (packId) {
        plan = await ensurePlan(packId);
        const facts = await loadFacts(state.store, packId);
        factCount = facts.length;
        progress = withBlank(await loadProgress(packId, state.store), facts);
        meta = await doneToday(await loadAttempts({ limit: 30, store: state.store }));
      }
    } catch {
      plan = null;
    }
    if (!alive) return;
    await ensureActiveLens();
    const home = trailHome(plan, progress, { done: meta, lastStudyAt: meta.lastStudyAt, t, sprintDays: getSprintDays() });
    draw(home);
  }

  root.append(
    h('div', { class: 'row' }, h('div', {}, h('div', { class: 'mut' }, t('trail.subtitle')), h('h1', { class: 'h1 disp' }, t('trail.title'))), mark(44, 'home')),
    body,
  );
  refresh = () => announce(t('trail.title'));
  boot();

  const unsubscribe = subscribe((type) => {
    if (alive && (type === 'sync' || type === 'session')) boot();
  });

  return {
    el: root,
    title: t('nav.trail'),
    mount: boot,
    destroy() {
      alive = false;
      unsubscribe();
      void refresh;
    },
  };
}
