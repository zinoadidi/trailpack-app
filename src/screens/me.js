// Me: account, language, theme, sync status, storage, AI model, usage,
// change password, delete account, sign out.

import { state, t, setLanguage, subscribe } from '../app/state.js';
import { h, bytesLabel, confirmDialog, toast, announce } from '../app/ui.js';
import { setPref, applyTheme } from '../app/prefs.js';
import { THEME_PREVIEW } from '../app/themes.js';
import { patchMe, reloadMe, signOut, refreshSession } from '../app/session.js';
import { BUILD_ID } from '../build-id.js';
import { navigate } from '../app/router.js';
import { estimateStorage, requestPersist } from '../store/files.js';
import { getPrefs } from '../app/prefs.js';
import { isSoundOn, setSoundOn, play } from '../game/sfx.js';

function syncIfEnabled() {
  if (state.online && getPrefs().sync !== false && state.user) state.sync?.sync();
}

export default function me() {
  let alive = true;
  const root = h('div', { class: 'stack' });
  let statusLine = null;
  let pendingLine = null;

  function section(title, ...children) {
    return h('section', { class: 'panel stack' }, h('h2', { class: 'h', style: { fontSize: '17px' } }, title), ...children);
  }

  function segControl(groupLabel, options, current, onPick) {
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': groupLabel });
    for (const opt of options) {
      seg.append(
        h(
          'button',
          { type: 'button', 'aria-pressed': String(current === opt.value), onclick: () => onPick(opt.value) },
          opt.label,
        ),
      );
    }
    return seg;
  }

  async function saveShort(patch, key = 'common.saved') {
    try {
      await patchMe(patch);
      toast(t(key));
    } catch {
      toast(t('admin.savingFailed'));
    }
  }

  /** One preview tile: a small colour sample painted from the theme's own palette. */
  function themeTile(theme, selected, onPick) {
    const swatch = h('span', { class: 'swatch', style: { background: theme.page } });
    swatch.append(
      h('i', { style: { width: '46%', background: theme.surface, height: '100%' } }),
      h('i', { style: { width: '16%', background: theme.spark } }),
      h('i', { style: { width: '16%', background: theme.volt } }),
      h('i', { style: { width: '14%', background: theme.text, 'aria-hidden': 'true' } }),
    );
    return h(
      'button',
      {
        class: 'themebtn',
        type: 'button',
        'aria-pressed': String(selected),
        'aria-label': t(theme.labelKey),
        onclick: () => onPick(theme.id),
      },
      swatch,
      h('span', { class: 'name' }, h('b', {}, t(theme.labelKey)), selected ? h('span', { class: 'tick', 'aria-hidden': 'true' }, '✓') : null),
    );
  }

  function themeSection() {
    const current = state.prefTheme || 'system';
    const pick = async (value) => {
      setPref('theme', value);
      state.prefTheme = value;
      applyTheme(value);
      await saveShort({ theme: value });
      navigate('/me', { replace: true });
    };
    return section(
      t('me.themeTitle'),
      h('p', { class: 'mut' }, t('me.themeHelp')),
      h(
        'div',
        { class: 'themes', role: 'group', 'aria-label': t('a11y.themeGroup') },
        ...THEME_PREVIEW.map((theme) => themeTile(theme, current === theme.id, pick)),
      ),
      h(
        'div',
        { class: 'row wrap', style: { gap: '8px' } },
        h('span', { class: 'mut small' }, t('me.themeSystemHelp')),
        h(
          'button',
          {
            class: 'btn sm' + (current === 'system' ? ' g' : ''),
            type: 'button',
            'aria-pressed': String(current === 'system'),
            onclick: () => pick('system'),
          },
          (current === 'system' ? '✓ ' : '') + t('me.themeSystem'),
        ),
      ),
    );
  }

  function syncSection() {
    const user = state.user;
    const status = state.syncStatus || 'idle';
    statusLine = h(
      'div',
      { class: 'row' },
      h(
        'span',
        { class: 'row', style: { gap: '8px' } },
        h('span', { class: 'syncdot ' + status, 'aria-hidden': 'true' }),
        h('b', {}, t('me.syncStatus.' + status)),
      ),
    );
    pendingLine = h('div', { class: 'mut' }, state.lastSyncAt ? t('me.syncLast', { when: new Date(state.lastSyncAt) }) : t('me.syncNever'));
    return section(
      t('me.syncTitle'),
      statusLine,
      pendingLine,
      status === 'error' ? h('div', { class: 'notice warn' }, h('p', {}, t('me.syncErrorHelp'))) : null,
      state.online ? null : h('div', { class: 'notice info' }, h('p', {}, t('sync.offline'))),
      h(
        'div',
        { class: 'row wrap', style: { gap: '8px' } },
        h(
          'button',
          {
            class: 'btn sm',
            type: 'button',
            onclick: async (e) => {
              const button = e.currentTarget;
              button.disabled = true;
              let res;
              try {
                await refreshSession();
                res = await state.sync.sync();
              } finally {
                button.disabled = false;
              }
              updateSyncLines();
              if (res.status === 'synced') toast(t('me.syncStatus.synced'));
            },
          },
          t('me.syncNow'),
        ),
        segControl(
          t('me.syncTitle'),
          [
            { value: true, label: t('common.yes') },
            { value: false, label: t('common.no') },
          ],
          state.syncEnabled !== false,
          async (value) => {
            state.syncEnabled = value;
            setPref('sync', value);
            toast(t('common.saved'));
            navigate('/me', { replace: true });
            if (value) syncIfEnabled();
          },
        ),
        h('span', { class: 'mut small' }, state.syncEnabled === false ? t('me.syncOff') : t('me.syncOn')),
        h('span', { class: 'mut small' }, user.email),
      ),
      h('p', { class: 'mut small' }, t('me.build', { id: BUILD_ID })),
    );
  }

  /** Sound on or off: a device preference (like the theme), off until switched on. */
  function soundSection() {
    let on = isSoundOn();
    const line = h('span', { class: 'mut small' }, on ? t('sound.on') : t('sound.off'));
    const toggle = h(
      'button',
      {
        class: 'btn sm' + (on ? ' g' : ''),
        type: 'button',
        'aria-pressed': String(on),
        onclick: () => {
          on = !on;
          setSoundOn(on);
          toggle.setAttribute('aria-pressed', String(on));
          toggle.className = 'btn sm' + (on ? ' g' : '');
          line.textContent = on ? t('sound.on') : t('sound.off');
          if (on) play('navigate');
          toast(t(on ? 'sound.on' : 'sound.off'));
        },
      },
      (on ? '✓ ' : '') + t('sound.toggle'),
    );
    return section(t('sound.title'), h('p', { class: 'mut' }, t('sound.help')), h('div', { class: 'row wrap', style: { gap: '8px' } }, toggle, line));
  }

  function updateSyncLines() {
    if (!statusLine) return;
    const status = state.syncStatus || 'idle';
    statusLine.lastElementChild.querySelector('.syncdot').className = 'syncdot ' + status;
    statusLine.querySelector('b').textContent = t('me.syncStatus.' + status);
    pendingLine.textContent = state.lastSyncAt ? t('me.syncLast', { when: new Date(state.lastSyncAt) }) : t('me.syncNever');
  }

  function storageSection() {
    const s = state.storage || { usage: 0, quota: 0, persisted: false };
    return section(
      t('me.storageTitle'),
      s.quota ? h('p', { class: 'mut' }, t('me.storageUsed', { used: bytesLabel(s.usage), quota: bytesLabel(s.quota) })) : h('p', { class: 'mut' }, '—'),
      s.quota ? h('div', { class: 'pbar', 'aria-hidden': 'true' }, h('i', { style: { width: Math.min(100, Math.round((s.usage / s.quota) * 100)) + '%' } })) : null,
      h(
        'div',
        { class: 'row wrap', style: { gap: '8px' } },
        h('span', { class: 'chip ' + (s.persisted ? 'm' : '') }, s.persisted ? t('me.storagePersistOn') : t('me.storagePersistOff')),
        h(
          'button',
          {
            class: 'btn sm',
            type: 'button',
            onclick: async () => {
              const persisted = await requestPersist();
              state.storage = { ...(await estimateStorage()), persisted };
              toast(t('common.saved'));
              navigate('/me', { replace: true });
            },
          },
          t('me.storagePersist'),
        ),
      ),
      s.low ? h('div', { class: 'notice warn' }, h('p', {}, t('me.storageLow'))) : null,
      h(
        'button',
        {
          class: 'btn sm danger',
          type: 'button',
          onclick: async () => {
            const ok = await confirmDialog({ title: t('me.storageClear'), body: t('me.storageClearHelp'), confirm: t('me.storageClear'), cancel: t('common.cancel') });
            if (!ok) return;
            await state.store.wipe();
            toast(t('me.storageCleared'));
          },
        },
        t('me.storageClear'),
      ),
    );
  }

  function modelSection() {
    const models = state.models.models.length
      ? state.models.models
      : [
          { id: 'muse', label: 'Muse', available: true },
          { id: 'deepseek-flash', label: 'DeepSeek Flash', available: true },
        ];
    const current = state.user.model;
    const usage = state.usage || { tokensToday: 0, budgetToday: 0 };
    const pct = usage.budgetToday ? Math.min(100, Math.round((usage.tokensToday / usage.budgetToday) * 100)) : 0;

    function opt(id, label, help, badge) {
      const sel = current === id;
      return h(
        'button',
        {
          class: 'opt' + (sel ? ' sel' : ''),
          type: 'button',
          'aria-pressed': String(sel),
          style: { textAlign: 'left', width: '100%', color: 'inherit', font: 'inherit' },
          onclick: async () => {
            await saveShort({ model: id }, 'me.modelSaved');
            state.models.default = id;
            navigate('/me', { replace: true });
          },
        },
        h('span', { class: 'radio', 'aria-hidden': 'true' }),
        h('span', { style: { flex: '1' } }, h('span', { class: 'row' }, h('b', {}, label), badge || null), h('span', { class: 'mut', style: { display: 'block' } }, help)),
      );
    }

    return section(
      t('me.modelTitle'),
      models.map((m) =>
        opt(
          m.id === 'auto' ? 'auto' : m.id,
          m.id === 'auto' ? t('me.modelAuto') : m.id === 'muse' ? t('me.modelMuse') : m.id === 'deepseek-flash' ? t('me.modelDeepseek') : m.label,
          m.id === 'muse' ? t('me.modelMuseHelp') : m.id === 'deepseek-flash' ? t('me.modelDeepseekHelp') : '',
          m.id === state.models.default ? h('span', { class: 'chip o' }, '✦ ' + t('me.modelDefaultBadge')) : !m.available ? h('span', { class: 'chip e' }, t('me.modelUnavailable')) : null,
        ),
      ),
      h('p', { class: 'hint' }, t('me.modelHelp')),
      h('div', { class: 'row', style: { marginTop: '4px' } }, h('b', { class: 'small' }, t('me.usageTitle')), h('span', { class: 'mut small' }, t('me.usageLine', { used: state.t.number(usage.tokensToday), limit: state.t.number(usage.budgetToday) }))),
      h('div', { class: 'pbar', 'aria-hidden': 'true' }, h('i', { style: { width: pct + '%' } })),
      h('p', { class: 'mut small' }, t('me.usageHelp')),
    );
  }

  function accountSection() {
    const user = state.user;
    const current = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', 'aria-label': t('me.currentPassword') });
    const next = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', minlength: 10, 'aria-label': t('me.newPassword') });
    return section(
      t('me.account'),
      h('div', { class: 'kv' }, h('dt', {}, t('me.signedInAs', { name: user.name })), h('dd', {}, user.email), h('dt', {}, t('common.language')), h('dd', {}, t('languages.' + user.lang))),
      h('details', {}, h('summary', { class: 'btn sm', style: { display: 'inline-flex' } }, t('me.changePassword')),
        h(
          'div',
          { class: 'stack', style: { marginTop: '10px' } },
          current,
          next,
          h(
            'button',
            {
              class: 'btn sm',
              type: 'button',
              onclick: async () => {
                try {
                  await state.api.changePassword(current.value, next.value);
                  current.value = '';
                  next.value = '';
                  toast(t('me.passwordChanged'));
                } catch {
                  toast(t('me.deleteWrongPassword'));
                }
              },
            },
            t('common.save'),
          ),
        ),
      ),
    );
  }

  function dangerSection() {
    const pw = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', 'aria-label': t('me.deleteConfirmTitle') });
    return section(
      t('me.dangerTitle'),
      h('p', { class: 'mut' }, t('me.deleteHelp')),
      h('details', {},
        h('summary', { class: 'btn sm danger', style: { display: 'inline-flex' } }, t('me.deleteAccount')),
        h('div', { class: 'stack', style: { marginTop: '10px' } },
          h('p', { class: 'small' }, t('me.deleteConfirmBody')),
          pw,
          h('button', {
            class: 'btn danger',
            type: 'button',
            onclick: async () => {
              try {
                await state.api.deleteMe(pw.value);
                await signOut({ wipe: true });
                navigate('/access', { replace: true });
              } catch {
                toast(t('me.deleteWrongPassword'));
              }
            },
          }, t('me.deleteAccount')),
        ),
      ),
    );
  }

  function signOutSection() {
    const wipe = h('input', { type: 'checkbox', id: 'wipe' });
    return section(
      t('common.signOut'),
      h('p', { class: 'mut' }, t('me.signOutHelp')),
      h('label', { class: 'row', for: 'wipe', style: { justifyContent: 'flex-start', gap: '10px' } }, wipe, h('span', { class: 'small' }, t('me.signOutWipe'))),
      h('button', {
        class: 'btn',
        type: 'button',
        onclick: async () => {
          await signOut({ wipe: wipe.checked });
          navigate('/access', { replace: true });
        },
      }, t('common.signOut')),
    );
  }

  function build() {
    const user = state.user;
    root.replaceChildren(
      h('div', { class: 'row' }, h('h1', { class: 'h1' }, t('me.title')), h('a', { class: 'btn sm g', href: '#/language' }, t('common.language') + ': ' + t('languages.' + user.lang))),
      themeSection(),
      soundSection(),
      h('section', { class: 'panel stack' }, h('h2', { class: 'h', style: { fontSize: '17px' } }, t('mixer.title')), h('p', { class: 'mut' }, t('mixer.subtitle')), h('a', { class: 'btn sm g', href: '#/mixer' }, t('mixer.title'))),
      h('section', { class: 'panel stack' }, h('div', { class: 'row wrap', style: { gap: '8px' } }, h('a', { class: 'btn sm g', href: '#/progress' }, t('game.profileTitle')), h('a', { class: 'btn sm g', href: '#/exports' }, t('export.title')))),
      syncSection(),
      storageSection(),
      modelSection(),
      accountSection(),
      dangerSection(),
      signOutSection(),
    );
  }

  build();

  const unsubscribe = subscribe((type) => {
    if (!alive) return;
    if (type === 'sync') updateSyncLines();
  });

  return {
    el: root,
    title: t('me.title'),
    async mount() {
      try {
        const { user, usage } = await reloadMe();
        if (alive && user) {
          void usage;
          state.storage = { ...(await estimateStorage()), persisted: (state.storage && state.storage.persisted) || false };
          build();
          announce(t('me.title'));
        }
      } catch {
        /* keep cached view */
      }
      try {
        state.models = await state.api.models();
      } catch {
        /* model list falls back to the two known ids */
      }
    },
    destroy() {
      alive = false;
      unsubscribe();
    },
  };
}
