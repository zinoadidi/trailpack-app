// Topic map editor for the review screen: the fact count per topic, rename,
// merge, drop, the freeze button and the variant generation step.
//
// It holds no rules of its own: edits are handed to `applyEdits` (pure, in
// src/study/library.js) and the result is returned through `onChange` so the
// screen can persist it. That keeps "what the review screen does" testable.

import { t } from '../app/state.js';
import { h, confirmDialog } from '../app/ui.js';
import { applyEdits, canFreeze, reviewSummary, variantsProgress } from '../study/library.js';
import { reviewQueue } from '../study/pack.js';
import { progressBar } from '../game/screen-helpers.js';

/** Group facts by topic id, for the counts and the source chips. */
export function factsByTopic(facts = []) {
  const map = new Map();
  for (const fact of facts) {
    if (!map.has(fact.topicId)) map.set(fact.topicId, []);
    map.get(fact.topicId).push(fact);
  }
  return map;
}

export function topicEditor({ pack, topics, facts, edits, frozen, onChange, onFreeze, onGenerate, onRenamePack, onMakeActive, onDelete, protectedTopicIds = [], additionMode = false, busy = false }) {
  const view = h('div', { class: 'stack' });
  const protectedTopics = new Set(protectedTopicIds);
  let working = { edits: edits || { dropped: [], renamed: {}, merged: {} }, topics, facts };

  function commit(patch) {
    const nextEdits = { ...working.edits, ...patch };
    const applied = applyEdits(working.topics, working.facts, nextEdits);
    working = { edits: nextEdits, topics: applied.topics, facts: applied.facts };
    onChange(working);
    paint();
  }

  async function removeFact(fact) {
    working = { ...working, facts: working.facts.filter((item) => item.id !== fact.id) };
    await onChange(working);
    paint();
  }

  function editFact(fact) {
    const input = h('textarea', { class: 'input', maxlength: '600', 'aria-label': t('review.editFact'), value: fact.statement });
    const dialog = h('dialog', { 'aria-labelledby': 'edit-fact-title' });
    const close = () => { dialog.close(); dialog.remove(); };
    dialog.append(h('div', { class: 'sheet stack' },
      h('h2', { id: 'edit-fact-title', class: 'h' }, t('review.editFact')),
      h('p', { class: 'mut small' }, t('review.editFactHelp')),
      input,
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: close }, t('common.cancel')),
        h('button', { class: 'btn p', type: 'button', onclick: async () => {
          const statement = input.value.trim();
          if (!statement) return;
          close();
          if (statement === fact.statement) return;
          working = { ...working, facts: working.facts.map((item) => item.id === fact.id
            ? { ...item, statement, variants: [], sourceId: null, chunkId: null, page: null, check: 1 } : item) };
          await onChange(working);
          paint();
        } }, t('common.save')))));
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
  }

  function rename(topic) {
    const input = h('input', { class: 'input', type: 'text', value: topic.title, maxlength: '160', 'aria-label': t('review.renameLabel') });
    const dlg = h('dialog', { 'aria-labelledby': 'ren-t' });
    const close = () => {
      dlg.close();
      dlg.remove();
    };
    const save = () => {
      const title = input.value.trim();
      close();
      if (!title || title === topic.title) return;
      commit({ renamed: { ...working.edits.renamed, [topic.id]: title } });
    };
    dlg.append(
      h(
        'div',
        { class: 'sheet stack' },
        h('h2', { id: 'ren-t', class: 'h' }, t('review.renameTitle')),
        input,
        h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: close }, t('common.cancel')), h('button', { class: 'btn p', type: 'button', onclick: save }, t('common.save'))),
      ),
    );
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save();
    });
    document.body.append(dlg);
    dlg.showModal();
    input.focus();
    input.select();
  }

  async function merge(topic) {
    const others = working.topics.filter((item) => item.id !== topic.id);
    if (!others.length) return;
    const select = h('select', { class: 'select', 'aria-label': t('review.mergeInto') }, ...others.map((item) => h('option', { value: item.id }, item.title)));
    const dlg = h('dialog', { 'aria-labelledby': 'mrg-t' });
    const close = () => {
      dlg.close();
      dlg.remove();
    };
    dlg.append(
      h(
        'div',
        { class: 'sheet stack' },
        h('h2', { id: 'mrg-t', class: 'h' }, t('review.mergeTitle', { title: topic.title })),
        select,
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn', type: 'button', onclick: close }, t('common.cancel')),
          h(
            'button',
            {
              class: 'btn p',
              type: 'button',
              onclick: () => {
                const into = select.value;
                close();
                if (into) commit({ merged: { ...working.edits.merged, [topic.id]: into } });
              },
            },
            t('review.merge'),
          ),
        ),
      ),
    );
    document.body.append(dlg);
    dlg.showModal();
  }

  async function drop(topic) {
    const ok = await confirmDialog({ title: t('review.dropTitle', { title: topic.title }), body: t('review.dropBody'), confirm: t('review.drop'), cancel: t('common.cancel') });
    if (!ok) return;
    commit({ dropped: [...new Set([...(working.edits.dropped || []), topic.id])] });
  }

  function paint() {
    const list = working.topics;
    const summary = reviewSummary(list, working.facts);
    const perTopic = factsByTopic(working.facts);
    const needsReview = new Map();
    for (const item of reviewQueue(working.facts, list).items) {
      needsReview.set(item.topicId, (needsReview.get(item.topicId) || 0) + 1);
    }
    const check = canFreeze(pack, list, working.facts);
    const variants = variantsProgress(working.facts);

    const rows = list.length
      ? list.map((topic, index) => {
          const count = (perTopic.get(topic.id) || []).length;
          return h(
            'div',
            { class: 'panel stack' },
            h(
              'div',
              { class: 'row' },
              h('div', {}, h('b', {}, index + 1 + '. ' + topic.title), topic.summary ? h('p', { class: 'mut small' }, topic.summary) : null),
              h('span', { class: 'chip v' }, t('review.factCount', { count })),
              needsReview.get(topic.id) ? h('span', { class: 'chip a' }, t('flow.needsReviewCount', { count: needsReview.get(topic.id) })) : null,
            ),
            frozen || busy || protectedTopics.has(topic.id)
              ? null
              : h(
                  'div',
                  { class: 'row wrap', style: { gap: '6px' } },
                  h('button', { class: 'btn sm', type: 'button', onclick: () => rename(topic) }, t('review.rename')),
                  h('button', { class: 'btn sm', type: 'button', disabled: list.length < 2, onclick: () => merge(topic) }, t('review.merge')),
                  h('button', { class: 'btn sm danger', type: 'button', onclick: () => drop(topic) }, t('review.drop')),
                ),
            additionMode && !frozen ? h('div', { class: 'stack' }, ...(perTopic.get(topic.id) || []).map((fact) =>
              h('div', { class: 'fact-edit-row' }, h('span', {}, fact.statement),
                h('button', { class: 'btn sm', type: 'button', disabled: busy, onclick: () => editFact(fact), 'aria-label': t('review.editFact') + ': ' + fact.statement }, t('review.editFact')),
                h('button', { class: 'btn sm danger', type: 'button', disabled: busy, onclick: () => removeFact(fact), 'aria-label': t('review.removeFact') + ': ' + fact.statement }, t('review.removeFact'))))) : null,
          );
        })
      : [h('p', { class: 'mut small' }, t('review.noTopics'))];

    const children = [
      h(
        'div',
        { class: 'row' },
        h('h2', { class: 'h small' }, t('review.title')),
        h('span', { class: 'mut small' }, t('review.summary', { topicCount: summary.topics, factCount: summary.facts })),
      ),
      summary.unsourced ? h('div', { class: 'notice warn' }, h('p', {}, t('review.unsourced', { count: summary.unsourced }))) : null,
      summary.lowConfidence ? h('div', { class: 'notice warn' }, h('p', {}, t('review.lowConfidence', { count: summary.lowConfidence }))) : null,
      ...rows,
      frozen
        ? h(
            'div',
            { class: 'panel stack' },
            h('div', { class: 'row' }, h('b', {}, t('review.variantsTitle')), h('span', { class: 'mut small' }, t('review.variantsCount', { done: variants.done, total: variants.total }))),
            progressBar(variants.total ? (variants.done / variants.total) * 100 : 0, t('review.variantsCount', { done: variants.done, total: variants.total })),
            h('p', { class: 'mut small' }, varRing_help(variants)),
            h(
              'div',
              { class: 'row wrap', style: { gap: '8px' } },
              h('button', { class: 'btn p sm', type: 'button', disabled: variants.complete, onclick: onGenerate }, variants.complete ? t('review.variantsDone') : t('review.generate')),
              h('button', { class: 'btn sm', type: 'button', onclick: onMakeActive }, t('review.makeActive')),
              h('a', { class: 'btn sm', href: '#/' }, t('review.startTrail')),
            ),
          )
        : null,
      h(
        'div',
        { class: 'row wrap', style: { gap: '8px' } },
        frozen ? null : h('button', { class: 'btn p', type: 'button', disabled: busy || !check.ok, onclick: onFreeze }, t(additionMode ? 'library.createReplacement' : 'review.freeze')),
        h(
          'button',
          {
            class: 'btn',
            type: 'button',
            disabled: additionMode,
            onclick: () => {
              const input = h('input', { class: 'input', type: 'text', value: pack.title, maxlength: '160', 'aria-label': t('library.packTitle') });
              const dlg = h('dialog', { 'aria-labelledby': 'ren-p' });
              const close = () => {
                dlg.close();
                dlg.remove();
              };
              dlg.append(
                h(
                  'div',
                  { class: 'sheet stack' },
                  h('h2', { id: 'ren-p', class: 'h' }, t('library.packTitle')),
                  input,
                  h(
                    'div',
                    { class: 'row' },
                    h('button', { class: 'btn', type: 'button', onclick: close }, t('common.cancel')),
                    h(
                      'button',
                      {
                        class: 'btn p',
                        type: 'button',
                        onclick: () => {
                          const title = input.value.trim();
                          close();
                          if (title) onRenamePack(title);
                        },
                      },
                      t('common.save'),
                    ),
                  ),
                ),
              );
              document.body.append(dlg);
              dlg.showModal();
              input.focus();
            },
          },
          t('review.renamePack'),
        ),
        additionMode ? null : h('button', { class: 'btn danger', type: 'button', onclick: onDelete }, t('library.deletePack')),
      ),
      frozen ? null : h('p', { class: 'mut small' }, check.ok ? t(additionMode ? 'library.replacementFreezeHelp' : 'review.freezeHelp') : t(check.problems[0])),
    ];
    view.replaceChildren(...children.filter((child) => child !== null && child !== undefined && child !== false));
  }

  function varRing_help(variants) {
    if (variants.complete) return t('review.variantsAllDone');
    return t('review.variantsHelp');
  }

  paint();
  return view;
}
