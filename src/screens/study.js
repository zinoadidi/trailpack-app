// The study runner (#/study): one bite, from the Session organiser to the
// Bite complete screen.
//
// It owns no rules. It loads the pack bundle, starts a session with
// `startSession`, renders the current step through the activity modules in
// ./activities/ and hands every answer to `answerStep`. Every answered step is
// then paid once through `src/game/wire-run.js` (points, streaks, levels,
// badges, sounds); the last step of the bite closes it, pays the finish bonus
// and routes to #/bite for the celebration.
//
// The live session is kept on `state.studySession` so Practice can offer to
// resume it. One step is answered once, so a double click cannot pay twice
// (`recordStep` also remembers the step and fact on the game profile).

import { state, t } from '../app/state.js';
import { h, announce, toast, confirmDialog } from '../app/ui.js';
import { navigate } from '../app/router.js';
import { resolveActivePack } from '../study/store.js';
import { loadProgress, saveProgressMany, loadPlan, loadMixerSettings, loadStudyMeta, saveStudyMeta, saveAttempts } from '../study/progress-store.js';
import { startSession, currentStep, answerStep, stepVariant, sessionAttempts, finishSession, stepPlayable } from '../study/session.js';
import { renderActivity } from './activities/index.js';
import { recordStep, recordBite, recordFinish, finishPoints, sound, soundFailed, soundFlip, answerStreak, levelOptions, newLevels, readProfileSafe } from '../game/wire-run.js';
import { levelState, readProfile } from '../game/screen-helpers.js';
import { STREAK_TOAST_MIN, sfxFor } from '../game/wire.js';

/** Score one answer on the session and save the mastery doc (not for a skip). */
async function recordAnswer(session, answer, { skipped = false, facts = [] } = {}) {
  const raw = skipped ? { correct: false } : { ...answer, ms: (answer && answer.ms) || 0 };
  const out = answerStep(session, raw, { facts, now: Date.now(), skipped, countsAsMiss: false });
  if (out.progressDoc && !skipped) await saveProgressMany([out.progressDoc]).catch(() => null);
  return { out, correct: Boolean(out.answer && out.answer.correct) };
}

export default function study() {
  const root = h('div', { class: 'stack' });
  const head = h('div', { class: 'stack', style: { gap: '8px' } });
  const body = h('div', { class: 'stack', 'aria-live': 'polite' });
  const foot = h('div', { class: 'stack' });
  root.append(head, body, foot);
  let busy = false;
  let answered = false;

  async function boot() {
    const bundle = await resolveActivePack().catch(() => null);
    if (!bundle || !bundle.facts || !bundle.facts.length) {
      body.append(emptyState());
      return;
    }
    const { pack, facts } = bundle;
    const [progress, trail, settings, meta] = await Promise.all([loadProgress(pack.id), loadPlan(pack.id), loadMixerSettings(), loadStudyMeta()]);
    const asked = new URLSearchParams(location.hash.split('?')[1] || '').get('steps');
    const camp = trail && Array.isArray(trail.camps) ? trail.camps.find((item) => item.state === 'open') : null;
    const session = startSession({
      facts,
      progress,
      trail,
      settings,
      campId: camp ? camp.id : null,
      steps: asked ? Number(asked) : null,
      seed: (Date.now() % 1000000) + 1,
      history: { typesSeen: meta.typesSeen || [] },
      now: Date.now(),
    });
    if (!session.steps.length) {
      body.append(emptyState());
      return;
    }
    state.studySession = { session, pack, facts, trail, trailProfile: await readProfileSafe() };
    paint();
  }

  function emptyState() {
    return h(
      'section',
      { class: 'panel stack' },
      h('h1', { class: 'h1' }, t('study.title')),
      h('p', { class: 'mut' }, t('study.noFacts')),
      h('div', { class: 'row wrap', style: { gap: '8px' } }, h('a', { class: 'btn p', href: '#/library' }, t('library.addDocument')), h('a', { class: 'btn', href: '#/practice' }, t('practice.title'))),
    );
  }

  function paintHeader(session) {
    const held = state.studySession;
    const total = session.steps.length;
    const done = session.index;
    const label = t('study.stepOf', { step: Math.min(done + 1, total), total });
    const gained = (session.answers || []).reduce((sum, row) => sum + (Number(row.points) || 0), 0);
    const streak = answerStreak(session);
    const level = levelState(held && held.trailProfile, levelOptions(held && held.trail)).level;
    head.replaceChildren(
      h(
        'div',
        { class: 'row wrap' },
        h('span', { class: 'mut small' }, label),
        h('span', { class: 'chip a' }, t('study.stepPoints', { points: gained })),
        streak >= STREAK_TOAST_MIN ? h('span', { class: 'chip v' }, t('wire.toast.streak', { count: streak })) : null,
        h('span', { class: 'chip t' }, t('wire.toast.level', { level })),
        (session.answers || []).some((row) => row && row.points > 0) ? h('a', { class: 'chip k', href: '#/progress' }, t('game.profileTitle')) : null,
      ),
      h(
        'div',
        { class: 'studyBar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(done), 'aria-label': label },
        ...Array.from({ length: total }, (_, i) => h('i', { class: 'studySeg' + (i < done ? ' done' : i === done ? ' now' : '') })),
      ),
    );
  }

  function paint() {
    const held = state.studySession;
    if (!held) return;
    const { session } = held;
    answered = false;
    body.replaceChildren();
    foot.replaceChildren();
    paintHeader(session);
    const step = currentStep(session);
    if (!step) {
      store();
      return;
    }
    const drawn = stepVariant(step, held.facts);
    if (!drawn || !drawn.variant || !stepPlayable(step, held.facts)) {
      // A fact that lost every format must not block the bite.
      toast(t('study.loadFailed'));
      soundFailed();
      advance({ correct: false }, true, null);
      return;
    }
    const ctx = {
      t,
      fact: drawn.fact,
      variant: drawn.variant,
      step,
      index: session.index,
      total: session.steps.length,
      onAnswer(answer) {
        if (answered) return;
        answered = true;
        advance(answer, false, drawn);
      },
      onFlip() {
        soundFlip();
      },
    };
    const holder = h('div', { class: 'stack' });
    body.append(holder);
    renderActivity(holder, step, ctx).then((result) => {
      if (result && result.fallback) holder.append(h('p', { class: 'mut small' }, t('study.fallbackFlash')));
    });
    foot.append(
      h(
        'div',
        { class: 'row wrap', style: { gap: '8px' } },
        h('button', { class: 'btn sm', type: 'button', onclick: () => skip() }, t('study.skip')),
        h('button', { class: 'btn sm', type: 'button', onclick: () => leave() }, t('study.finishEarly')),
      ),
    );
  }

  async function advance(answer, skipped, drawn) {
    if (busy || !state.studySession) return;
    busy = true;
    const held = state.studySession;
    const outcome = await recordAnswer(held.session, answer, { skipped, facts: held.facts });
    if (!outcome || state.studySession !== held) {
      busy = false;
      return;
    }
    const { out, correct } = outcome;
    const nextHeld = { ...held, session: out.session };
    nextHeld.pendingStep = out.session.answers[out.session.answers.length - 1];
    state.studySession = nextHeld;
    const why = skipped ? '' : (drawn && drawn.variant && drawn.variant.why) || '';
    announce(t(skipped ? 'study.skip' : correct ? 'study.correct' : 'study.wrong') + (why ? '. ' + why : ''));
    paintHeader(out.session);
    body.append(
      h(
        'div',
        { class: 'stack', style: { gap: '6px' } },
        h('span', { class: 'chip ' + (skipped ? 'a' : correct ? 'm' : 'e'), style: { alignSelf: 'flex-start' } }, t(skipped ? 'study.skip' : correct ? 'study.correct' : 'study.wrong')),
        why ? h('p', {}, h('b', {}, t('study.why') + ': '), why) : null,
        h('button', { class: 'btn p block', type: 'button', onclick: () => paint() }, out.done ? t('study.finish') : t('study.next')),
      ),
    );
    foot.replaceChildren();
    if (out.done) {
      await store();
    } else {
      // Each answer pays through the game profile, even when the bite is left early.
      await payPending();
    }
    busy = false;
  }

  /** Pay the step saved on `pendingStep` once, so a repaint cannot pay twice. */
  async function payPending() {
    const held = state.studySession;
    const row = held && held.pendingStep;
    if (!row) return null;
    state.studySession = { ...held, pendingStep: null };
    const paid = await recordStep({ row, plan: held.trail, streak: answerStreak(held.session) });
    if (paid && paid.profile && state.studySession && !state.studySession.pendingStep) {
      state.studySession = { ...state.studySession, trailProfile: paid.profile };
      paintHeader(state.studySession.session);
    }
    return paid;
  }

  /** Close the bite: attempt row, study history, the game profile, then Bite complete. */
  async function store() {
    const held = state.studySession;
    if (!held) return;
    // The bite records every row through the game profile. A step answered
    // last that was already paid keeps its points in the summary but must not
    // be paid a second time, so `recordBite` takes the unpaid ones only.
    const session = held.session;
    const summary = finishSession(session);
    await saveAttempts(sessionAttempts(session)).catch(() => null);
    const meta = await loadStudyMeta();
    await saveStudyMeta({ ...meta, lastBiteAt: Date.now(), typesSeen: [...(meta.typesSeen || []), ...summary.activityTypes] }).catch(() => null);
    const recorded = await recordBite({ session: { ...session, minutes: summary.minutes }, plan: held.trail });
    // The finish bonus (+20 and the variety bonus) rides on the same bite id,
    // so it is paid once even if the Bite complete screen opens again.
    const finish = await recordFinish({ points: finishPoints(summary.activityTypes), activityTypes: summary.activityTypes, session, plan: held.trail });
    if (finish && finishPoints(summary.activityTypes) > 0) sound(sfxFor('bite'));
    const levels = finish ? newLevels(recorded ? recorded.profile.points : 0, finish.profile.points, levelOptions(held.trail)) : 0;
    if (levels) sound(sfxFor('level'));
    if (finish && finish.unlocked && finish.unlocked.length) sound(sfxFor('badge'));
    state.pendingBite = {
      stepPoints: summary.stepPoints,
      activityTypes: summary.activityTypes,
      minutes: summary.minutes,
      summary,
      session: { ...session, minutes: summary.minutes },
      plan: held.trail,
      recorded: true,
      newAchievements: [...((recorded && recorded.unlocked) || []), ...((finish && finish.unlocked) || [])],
    };
    state.studySession = null;
    navigate('/bite');
  }

  function skip() {
    if (!state.studySession) return;
    advance({ correct: false }, true, null);
  }

  async function leave() {
    const ok = await confirmDialog({ title: t('study.leaveTitle'), body: t('study.leaveBody'), confirm: t('study.leave'), cancel: t('study.stay') });
    if (!ok) return;
    state.studySession = null;
    navigate('/practice');
  }

  return {
    el: root,
    title: t('study.title'),
    async mount() {
      if (!state.studySession) await boot();
      else paint();
    },
  };
}
