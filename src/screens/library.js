// Library (#/library): packs, sources and the way in for new material.
//
// M2 flow, step by step and visible:
//   add (drop, pick or paste) -> read (extract) -> chunk -> map (ingest_map)
//   -> review screen -> freeze -> variants (generate)
//
// This file is the screen and the button wiring only. The decisions are the
// pure helpers in src/study/library.js and the network calls are in
// src/study/ingest.js, so everything testable is tested without a DOM.

import { state, t } from '../app/state.js';
import { h, toast, announce, confirmDialog, bytesLabel } from '../app/ui.js';
import { navigate } from '../app/router.js';
import { isAccepted, rejectReason, newPack, setSourceState, chunksForSource, wordsOf, applyMapReply, foldTopics, extensions } from '../study/library.js';
import { parseJsonReply } from '../study/prompts.js';
import { makeIngest } from '../study/ingest.js';
import { reviewQueue } from '../study/pack.js';
import { listPacks, deletePackDocs, setActivePack, activePackId, savePack, saveDraft, loadDraft, loadFacts, loadTopics } from '../study/store.js';

const ENGINE_STATES = {
  'reading-failed': 'ingest.failed',
  'mapping-failed': 'ingest.mapFailed',
  'variant-failed': 'ingest.variantFailed',
};

export default function library() {
  const root = h('div', { class: 'stack' });
  const packList = h('div', { class: 'stack' });
  const status = h('p', { class: 'mut small', 'aria-live': 'polite' });
  let busy = false;

  function setStatus(text) {
    status.textContent = text || '';
    if (text) announce(text);
  }

  // ---------------------------------------------------------------- adding

  function startPack() {
    const titleInput = h('input', { class: 'input', type: 'text', maxlength: '160', placeholder: t('library.titlePlaceholder') });
    const goalInput = h('textarea', { class: 'input', rows: '2', maxlength: '300', placeholder: t('library.goalPlaceholder') });
    const dlg = h('dialog', { 'aria-labelledby': 'lib-new' });
    const close = () => {
      dlg.close();
      dlg.remove();
    };
    dlg.append(
      h(
        'div',
        { class: 'sheet stack' },
        h('h2', { id: 'lib-new', class: 'h' }, t('library.newPack')),
        h('label', { class: 'field stack' }, h('span', { class: 'small' }, t('library.packTitle')), titleInput),
        h('label', { class: 'field stack' }, h('span', { class: 'small' }, t('library.packGoal') + ' · ' + t('common.optional')), goalInput),
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn', type: 'button', onclick: close }, t('common.cancel')),
          h(
            'button',
            {
              class: 'btn p',
              type: 'button',
              onclick: async () => {
                const title = titleInput.value.trim();
                if (!title) {
                  titleInput.focus();
                  return;
                }
                const pack = newPack({ title, goal: goalInput.value.trim(), lang: state.user?.studyLang || 'en' });
                // The draft is what the review screen opens: without it the new
                // Pack would only exist on the review screen's own first save.
                await saveDraft({ pack, topics: [], facts: [], edits: { dropped: [], renamed: {}, merged: {} } }).catch(() => null);
                close();
                navigate('/library/review?id=' + encodeURIComponent(pack.id));
              },
            },
            t('library.createAndAdd'),
          ),
        ),
      ),
    );
    document.body.append(dlg);
    dlg.showModal();
    titleInput.focus();
  }

  // ---------------------------------------------------------------- list

  async function renderList() {
    const packs = await listPacks();
    if (!packs.length) {
      packList.replaceChildren(h('div', { class: 'panel' }, h('p', { class: 'mut' }, t('library.empty')), h('button', { class: 'btn p block', type: 'button', onclick: startPack }, t('library.newPack'))));
      return;
    }
    packList.replaceChildren(
      ...(await Promise.all(
        packs.map(async (pack) => {
          const active = (await activePackId()) === pack.id;
          const draft = pack.status === 'draft';
          const draftData = draft ? await loadDraft(state.store, pack.id) : null;
          const facts = draftData ? draftData.facts || [] : await loadFacts(state.store, pack.id);
          const topics = draftData ? draftData.topics || [] : await loadTopics(state.store, pack.id);
          const needsReview = reviewQueue(facts, topics).count;
          return h(
            'a',
            { class: 'panel stack', href: '#/library/review?id=' + encodeURIComponent(pack.id), style: { textDecoration: 'none', color: 'inherit' } },
            h(
              'div',
              { class: 'row' },
              h('b', {}, pack.title || t('library.untitled')),
              h('span', { class: 'chip ' + (draft ? 'a' : 'm') }, draft ? t('library.statusDraft') : t('library.statusFrozen')),
            ),
            pack.goal ? h('p', { class: 'mut small' }, pack.goal) : null,
            h(
              'div',
              { class: 'row wrap', style: { gap: '6px' } },
              h('span', { class: 'chip k' }, t('library.sourceCount', { count: (pack.sources || []).length })),
              needsReview ? h('span', { class: 'chip a' }, t('flow.needsReviewCount', { count: needsReview })) : null,
              active ? h('span', { class: 'chip v' }, t('library.isActive')) : null,
            ),
          );
        }),
      )),
    );
  }

  // ---------------------------------------------------------------- mount

  root.append(
    h('div', { class: 'row' }, h('h1', { class: 'h1' }, t('nav.library')), h('button', { class: 'btn p sm', type: 'button', onclick: startPack }, t('library.newPack'))),
    h('p', { class: 'mut' }, t('library.intro')),
    status,
    h('h2', { class: 'h small' }, t('library.packList')),
    packList,
    h('h2', { class: 'h small' }, t('library.howTo')),
    h('div', { class: 'panel stack' }, h('p', { class: 'mut small' }, t('library.dropHelp', { types: extensions }))),
  );

  renderList();

  return {
    el: root,
    title: t('nav.library'),
    refresh: renderList,
    mount() {
      renderList();
    },
  };
}

void isAccepted;
void rejectReason;
void newPack;
void setSourceState;
void chunksForSource;
void wordsOf;
void applyMapReply;
void foldTopics;
void parseJsonReply;
void makeIngest;
void deletePackDocs;
void setActivePack;
void savePack;
void ENGINE_STATES;
void confirmDialog;
void bytesLabel;
void toast;
