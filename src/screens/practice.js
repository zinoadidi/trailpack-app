// Practice lets a learner drill one available activity or start a mixed bite.
import { state, t } from '../app/state.js';
import { h, append } from '../app/ui.js';
import { navigate } from '../app/router.js';
import { ACTIVITIES } from '../study/activities.js';
import { dueFacts } from '../study/mastery.js';
import { resolveActivePack } from '../study/store.js';
import { loadProgress } from '../study/progress-store.js';
import { biteLength } from '../study/mixer.js';
import { availablePracticeTypes } from './practice-run.js';
import { renderPracticeRound } from './practice-round.js';

export default function practice() {
  const root = h('div', { class: 'stack' });
  const box = h('div', { class: 'stack' });
  let activeRound = null;
  let weakOnly = false;
  root.append(h('h1', { class: 'h1' }, t('practice.title')), h('p', { class: 'mut' }, t('practice.subtitle')), box);

  async function paint() {
    activeRound?.destroy();
    activeRound = null;
    box.replaceChildren();
    const bundle = await resolveActivePack().catch(() => null);
    if (!bundle || !bundle.facts?.length) {
      box.append(h('section', { class: 'panel stack' }, h('p', {}, t('practice.nothing')), h('a', { class: 'btn p', href: '#/library' }, t('library.addDocument'))));
      return;
    }
    const progress = await loadProgress(bundle.pack.id).catch(() => ({}));
    const due = dueFacts(progress);
    const weak = due.byState.weak.length;
    const drillFacts = weakOnly ? bundle.facts.filter((fact) => due.byState.weak.includes(fact.id)) : bundle.facts;
    const fresh = bundle.facts.filter((fact) => !progress[fact.id] || progress[fact.id].state === 'new').length;
    const minutes = 4;
    const steps = biteLength(minutes);
    // append() drops null children; a raw box.append() would print the literal
    // word "null" where an optional panel is missing.
    append(box, [
      h('div', { class: 'panel row' }, h('div', {}, h('span', { class: 'mut small' }, t('practice.activePack')), h('b', {}, bundle.pack.title)), h('a', { class: 'btn', href: '#/library' }, t('practice.changePack'))),
      state.studySession ? h('section', { class: 'panel stack' }, h('b', {}, t('practice.resume')), h('p', { class: 'mut small' }, t('practice.resumeLine', { step: state.studySession.session.index, total: state.studySession.session.steps.length })), h('button', { class: 'btn p block', onclick: () => navigate('/study') }, t('practice.resume'))) : null,
      h('section', { class: 'panel stack' }, h('button', { class: 'btn p block', onclick: () => startBite() }, t('practice.start')), h('p', { class: 'mut small' }, t('practice.startHelp', { minutes, steps }))),
      h('section', { class: 'panel stack' }, h('h2', {}, t(weakOnly ? 'practice.reviewWeak' : 'practice.pickType')),
        weakOnly ? h('button', { class: 'btn', type: 'button', onclick: () => { weakOnly = false; paint(); } }, t('practice.title')) : null,
        ...availablePracticeTypes(drillFacts).map((type) => h('button', { class: 'btn block', type: 'button', dataset: { practiceType: type }, onclick: () => startRound(type, drillFacts, progress) }, t(ACTIVITIES[type].label)))),
      h('section', { class: 'panel stack' }, h('b', {}, t('practice.reviewWeak')), h('p', { class: 'mut small' }, weak ? t('practice.weakOnlyLine') : t('practice.noWeak')), h('button', { class: 'btn block', type: 'button', disabled: !weak, onclick: () => { weakOnly = true; paint(); } }, t('practice.reviewWeak'))),
      h('section', { class: 'panel stack' },
        row(t('practice.due'), t('practice.dueLine', { count: due.due.length }), 'a'),
        row(t('practice.weak'), t('practice.weakLine', { count: weak }), 'f'),
        row(t('practice.new'), t('practice.newLine', { count: fresh }), 'v')),
    ]);
  }

  function row(label, value, tone) {
    return h('div', { class: 'row' }, h('span', {}, label), h('span', { class: 'chip ' + tone }, value));
  }

  // The third name is the progress map the round starts from. It must not be
  // called `progress` (facts and progress), or it would shadow the one paint()
  // loaded and every drill would run over facts with no progress at all.
  function startRound(type, facts, fromProgress) {
    activeRound = renderPracticeRound(box, { facts, progress: fromProgress, type, onExit: () => paint() });
  }

  function startBite() {
    state.studySession = null;
    navigate('/study');
  }

  return { el: root, title: t('practice.title'), mount: paint, refresh: paint, destroy() { activeRound?.destroy(); activeRound = null; } };
}
