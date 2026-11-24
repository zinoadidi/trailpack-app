// The question sheet (#/library/review/questions?id=...): every fact in one
// Pack that a human should read before relying on it, one line each, with the
// reason it was picked (`review-questions.noSource`, `review-questions.lowConfidence`).
//
// This is what "Open the review" opens from the Library. Before this screen
// existed that button went back to the review screen it was on, so pressing it
// looked like nothing had happened.

import { state, t } from '../app/state.js';
import { h } from '../app/ui.js';
import { loadPackBundle, loadDraft } from '../study/store.js';
import { reviewReasons } from '../study/pack.js';

/** The Pack id from the hash (`#/library/review/questions?id=p1`). */
function packIdFromHash() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  return params.get('id');
}

const REASON_KEY = {
  'no-source': 'review.unsourcedOne',
  'low-confidence': 'review.lowConfidenceOne',
};

export default function reviewQuestions() {
  const root = h('div', { class: 'stack' });
  let packId = null;

  async function paint() {
    packId = packIdFromHash();
    // The loading line is part of every paint's own children, so the paint
    // that follows replaces it: nothing is left saying "Loading" afterwards.
    root.replaceChildren(
      h('div', { class: 'mut small' }, t('nav.library')),
      h('h1', { class: 'h1' }, t('review.questionsTitle')),
      h('p', { class: 'mut', role: 'status' }, t('common.loading')),
    );
    if (!packId) { renderEmpty(); return; }
    // The draft comes first: review's persist() keeps a draft only in meta, so
    // there may be no Pack document at all until the Pack is frozen.
    const draft = await loadDraft(state.store, packId).catch(() => null);
    const bundle = await loadPackBundle(packId).catch(() => null);
    const pack = (bundle && bundle.pack) || (draft && draft.pack) || null;
    if (!pack) { renderEmpty(); return; }
    const { topics, facts } = factsOf(pack, bundle, draft);
    const rows = [];
    for (const fact of facts) {
      const reasons = reviewReasons(fact);
      if (!reasons.length) continue;
      const title = (topics.find((topic) => topic.id === fact.topicId) || {}).title || '';
      rows.push(
        h(
          'li',
          { class: 'panel stack' },
          h('span', { class: 'mut small' }, title),
          h('p', {}, String(fact.statement || fact.text || '')),
          h('span', { class: 'row wrap' }, ...reasons.map((reason) => h('span', { class: 'chip a' }, t(REASON_KEY[reason] || reason)))),
        ),
      );
    }
    root.replaceChildren(
      h('div', { class: 'row' }, h('div', {}, h('div', { class: 'mut small' }, t('nav.library')), h('h1', { class: 'h1' }, pack.title || t('library.untitled'))), h('a', { class: 'btn sm', href: '#/library/review?id=' + encodeURIComponent(packId) }, t('review.questionsBack'))),
      h('p', { class: 'mut' }, t('review.questionsHelp')),
      rows.length
        ? h('ol', { class: 'stack', style: { listStyle: 'none', padding: '0' } }, ...rows)
        : h('section', { class: 'panel stack' }, h('p', {}, t('review.questionsNone'))),
    );
  }

/**
 * A Pack that was frozen keeps its topics and facts as synced docs, but a draft
 * has them only in its draft document (`draft-<id>`) until it is frozen. Read
 * whichever holds this Pack's material, so the sheet works before and after
 * "Freeze the Pack".
 */
function factsOf(pack, bundle, draft) {
  if (pack.status !== 'draft') return { topics: (bundle && bundle.topics) || [], facts: (bundle && bundle.facts) || [] };
  if (draft && Array.isArray(draft.facts)) return { topics: draft.topics || [], facts: draft.facts };
  return { topics: (bundle && bundle.topics) || [], facts: (bundle && bundle.facts) || [] };
}

  function renderEmpty() {
    root.replaceChildren(
      h('h1', { class: 'h1' }, t('review.questionsTitle')),
      h('section', { class: 'panel stack' }, h('p', { class: 'mut' }, t('review.questionsMissing')), h('a', { class: 'btn p', href: '#/library' }, t('nav.library'))),
    );
  }

  return {
    el: root,
    title: t('review.questionsTitle'),
    mount: paint,
    refresh: paint,
    destroy() {},
  };
}

// Exported for the screen test: the route id is read from the hash.
export { packIdFromHash };
