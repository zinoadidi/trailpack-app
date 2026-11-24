import { state, t } from '../app/state.js';
import { h, confirmDialog } from '../app/ui.js';
import { listReplacementOffers, keepBothReplacement, replacementDeletionStatus, deleteReplacedPack } from '../study/store.js';

// The journal is device-local and survives navigation until a choice is made.
export async function renderReplacementOffers(container, { packId = null, onChange = async () => {} } = {}) {
  const offers = (await listReplacementOffers()).filter((offer) => !packId || offer.oldPackId === packId || offer.packId === packId);
  container.replaceChildren(...offers.map((offer) => {
    const title = offer.prepared.originalBaseline.pack.title || t('library.untitled');
    const message = h('p', { class: 'mut small', 'aria-live': 'polite' }, '');
    const deletionAction = h('span', { class: 'row' });
    let busy = false;
    const deleteButton = () => h('button', { class: 'btn danger', type: 'button', onclick: async () => {
      if (busy) return;
      busy = true;
      try {
        const confirmed = await confirmDialog({ title: t('library.deleteOldPack'), body: t('library.deleteOldWarning', { title }), confirm: t('library.deleteOldPack'), cancel: t('common.cancel') });
        if (!confirmed) return;
        const result = await deleteReplacedPack(offer.oldPackId, { store: state.store, sync: state.sync });
        if (!result.ok) { message.textContent = t('library.replacementDeleteBlocked'); deletionAction.replaceChildren(checkButton()); return; }
        await renderReplacementOffers(container, { packId, onChange });
        await onChange();
      } catch { message.textContent = t('library.replacementActionFailed'); } finally { busy = false; }
    } }, t('library.deleteOldPack'));
    const checkButton = () => h('button', { class: 'btn', type: 'button', onclick: async () => {
      if (busy) return;
      busy = true;
      try {
        message.textContent = t('library.replacementChecking');
        const eligibility = await replacementDeletionStatus(offer.oldPackId, { store: state.store, sync: state.sync });
        if (!eligibility.ok) { message.textContent = t('library.replacementDeleteBlocked'); return; }
        message.textContent = '';
        deletionAction.replaceChildren(deleteButton());
      } catch { message.textContent = t('library.replacementActionFailed'); } finally { busy = false; }
    } }, t('library.checkOldDeletion'));
    deletionAction.append(checkButton());
    return h('section', { class: 'panel stack' },
      h('h2', { class: 'h' }, t('library.replacementReady')),
      h('p', { class: 'mut small' }, t('library.replacementChoiceHelp', { title })),
      message,
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn', type: 'button', onclick: async () => {
          if (busy) return;
          busy = true;
          try {
            if (!await keepBothReplacement(offer.oldPackId)) { message.textContent = t('library.replacementActionFailed'); return; }
            await renderReplacementOffers(container, { packId, onChange });
            await onChange();
          } catch { message.textContent = t('library.replacementActionFailed'); } finally { busy = false; }
        } }, t('library.keepBoth')),
        deletionAction,
      ));
  }));
}
