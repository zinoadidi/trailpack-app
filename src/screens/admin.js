// Admin, owner only: study codes, accounts, usage, providers.

import { state, t } from '../app/state.js';
import { h, bytesLabel, confirmDialog, toast, announce } from '../app/ui.js';

export default function admin() {
  const root = h('div', { class: 'stack' });
  const codesBox = h('div', { class: 'panel stack' });
  const accountsBox = h('div', { class: 'panel stack' });
  const usageBox = h('div', { class: 'panel stack' });
  let alive = true;

  const note = h('input', { class: 'input', id: 'note', placeholder: t('admin.codeNotePlaceholder') });
  const days = h('input', { class: 'input', id: 'days', type: 'number', min: '1', max: '90', value: '7' });
  const budget = h('input', { class: 'input', id: 'budget', type: 'number', min: '1000', step: '1000', value: '200000' });
  const created = h('div', { hidden: true });

  async function createCode(e) {
    e.preventDefault();
    try {
      const res = await state.api.createCode({
        note: note.value.trim() || undefined,
        expiresInDays: Number(days.value) || 7,
        dailyTokenBudget: Number(budget.value) || 200000,
      });
      created.hidden = false;
      created.replaceChildren(
        h(
          'div',
          { class: 'notice ok stack' },
          h('p', { class: 'small', style: { fontWeight: '600' } }, t('admin.codeCreated')),
          h('code', { class: 'mono', style: { fontSize: '18px' } }, res.code),
          h('p', { class: 'mut small' }, t('admin.codeExpires', { when: new Date(res.expiresAt) })),
          h(
            'button',
            {
              class: 'btn sm',
              type: 'button',
              onclick: async () => {
                try {
                  await navigator.clipboard.writeText(res.code);
                  toast(t('common.copied'));
                } catch {
                  toast(res.code);
                }
              },
            },
            t('common.copy'),
          ),
        ),
      );
      note.value = '';
      await loadCodes();
    } catch {
      toast(t('admin.savingFailed'));
    }
  }

  function statusChip(status) {
    const cls = { unused: 'a', used: 'm', revoked: 'e', expired: '' }[status] || '';
    return h('span', { class: 'chip ' + cls }, t('admin.status.' + status));
  }

  async function loadCodes() {
    try {
      const codes = await state.api.listCodes();
      const unused = codes.filter((c) => c.status === 'unused').length;
      codesBox.replaceChildren(
        h('div', { class: 'row' }, h('h2', { class: 'h', style: { fontSize: '17px' } }, t('admin.codes')), h('span', { class: 'chip t' }, t('admin.codesUnused', { count: unused }))),
        h(
          'form',
          { class: 'stack', onsubmit: createCode },
          h('div', { class: 'field' }, h('label', { for: 'note' }, t('admin.codeNote')), note),
          h(
            'div',
            { class: 'inline-two' },
            h('div', { class: 'field' }, h('label', { for: 'days' }, t('admin.codeDays')), days),
            h('div', { class: 'field' }, h('label', { for: 'budget' }, t('admin.codeBudget')), budget),
          ),
          h('button', { class: 'btn p', type: 'submit' }, t('admin.createCode')),
        ),
        created,
        codes.length === 0
          ? h('p', { class: 'mut' }, t('admin.emptyCodes'))
          : h(
              'div',
              { class: 'rows' },
              ...codes.map((c) =>
                h(
                  'div',
                  { class: 'rowitem' },
                  h('div', {}, h('span', { class: 'mono small' }, 'TRL-••••-' + String(c.id).slice(-4).toUpperCase()), h('div', { class: 'mut small' }, c.note || '—'), h('div', { class: 'mut small' }, t('admin.createdAt', { when: new Date(c.createdAt) }))),
                  h(
                    'span',
                    { class: 'row', style: { gap: '6px' } },
                    statusChip(c.status),
                    c.status === 'unused'
                      ? h(
                          'button',
                          {
                            class: 'btn sm danger',
                            type: 'button',
                            onclick: async () => {
                              const ok = await confirmDialog({ title: t('admin.revoke'), body: t('admin.revokeConfirm'), confirm: t('admin.revoke'), cancel: t('common.cancel') });
                              if (!ok) return;
                              try {
                                await state.api.revokeCode(c.id);
                                await loadCodes();
                              } catch {
                                toast(t('admin.savingFailed'));
                              }
                            },
                          },
                          t('admin.revoke'),
                        )
                      : null,
                  ),
                ),
              ),
            ),
      );
    } catch {
      codesBox.replaceChildren(h('h2', { class: 'h' }, t('admin.codes')), h('div', { class: 'notice bad' }, h('p', {}, t('admin.loadFailed'))));
    }
  }

  async function loadAccounts() {
    try {
      const accounts = await state.api.listAccounts();
      const active = accounts.filter((a) => a.status === 'active').length;
      accountsBox.replaceChildren(
        h('div', { class: 'row' }, h('h2', { class: 'h', style: { fontSize: '17px' } }, t('admin.accounts')), h('span', { class: 'chip m' }, t('admin.accountsActive', { count: active }))),
        accounts.length === 0
          ? h('p', { class: 'mut' }, t('admin.emptyAccounts'))
          : h(
              'div',
              { class: 'rows' },
              ...accounts.map((a) =>
                h(
                  'div',
                  { class: 'rowitem' },
                  h(
                    'div',
                    {},
                    h('b', { class: 'small' }, a.name),
                    h('div', { class: 'mut small' }, a.email),
                    h('div', { class: 'mut small' }, `${t('admin.tokensToday', { used: state.t.number(a.tokensToday) })} · ${t('admin.syncBytes', { size: bytesLabel(a.syncBytes) })}`),
                    a.status === 'suspended' ? h('span', { class: 'chip e' }, t('admin.suspended')) : null,
                  ),
                  h(
                    'span',
                    { class: 'row wrap', style: { gap: '6px', justifyContent: 'flex-end' } },
                    h('span', { class: 'chip' }, a.role === 'owner' ? t('me.roleOwner') : t('me.roleMember')),
                    h(
                      'button',
                      {
                        class: 'btn sm',
                        type: 'button',
                        onclick: async () => {
                          try {
                            await state.api.updateAccount(a.id, { status: a.status === 'active' ? 'suspended' : 'active' });
                            await loadAccounts();
                          } catch {
                            toast(t('admin.savingFailed'));
                          }
                        },
                      },
                      a.status === 'active' ? t('admin.suspend') : t('admin.reinstate'),
                    ),
                    h(
                      'button',
                      {
                        class: 'btn sm danger',
                        type: 'button',
                        onclick: async () => {
                          const ok = await confirmDialog({ title: t('admin.deleteAccount'), body: t('admin.deleteConfirm'), confirm: t('admin.deleteAccount'), cancel: t('common.cancel') });
                          if (!ok) return;
                          try {
                            await state.api.deleteAccount(a.id);
                            await loadAccounts();
                          } catch (err) {
                            toast(err && err.code === 'last_owner' ? t('admin.lastOwner') : t('admin.savingFailed'));
                          }
                        },
                      },
                      t('admin.deleteAccount'),
                    ),
                  ),
                ),
              ),
            ),
      );
    } catch {
      accountsBox.replaceChildren(h('h2', { class: 'h' }, t('admin.accounts')), h('div', { class: 'notice bad' }, h('p', {}, t('admin.loadFailed'))));
    }
  }

  async function loadUsage() {
    try {
      const [usage, providers] = await Promise.all([state.api.usage(7), state.api.providers()]);
      usageBox.replaceChildren(
        h('div', { class: 'row' }, h('h2', { class: 'h', style: { fontSize: '17px' } }, t('admin.usage')), h('span', { class: 'mut small' }, t('admin.usageDays', { days: usage.days }))),
        h(
          'div',
          { class: 'rows' },
          ...(usage.users.length ? usage.users : [{ user: '—', calls: 0, tokens: 0 }]).map((u) =>
            h('div', { class: 'rowitem' }, h('span', { class: 'small' }, u.user), h('span', { class: 'mut small' }, `${t('admin.usageCalls')} ${u.calls} · ${t('admin.usageTokens')} ${state.t.number(u.tokens)}`)),
          ),
        ),
        h('p', { class: 'small mut', style: { fontWeight: '600' } }, t('admin.usagePerModel')),
        h(
          'div',
          { class: 'rows' },
          ...(usage.models.length ? usage.models : [{ model: '—', calls: 0, tokens: 0 }]).map((m) =>
            h('div', { class: 'rowitem' }, h('span', { class: 'small' }, m.model), h('span', { class: 'mut small' }, `${m.calls} · ${state.t.number(m.tokens)}`)),
          ),
        ),
        h('p', { class: 'small mut', style: { fontWeight: '600' } }, t('admin.providers')),
        h(
          'div',
          { class: 'rows' },
          h(
            'div',
            { class: 'rowitem' },
            h('span', { class: 'small' }, t('admin.providerMuse')),
            h('span', { class: 'chip ' + (providers.muse.ok ? 'm' : 'e') }, providers.muse.ok ? t('admin.providerOk') : providers.muse.configured ? t('admin.providerDown') : t('admin.providerMissing')),
          ),
          h(
            'div',
            { class: 'rowitem' },
            h('span', { class: 'small' }, t('admin.providerDeepseek')),
            h('span', { class: 'chip ' + (providers.deepseekFlash.ok ? 'm' : 'e') }, providers.deepseekFlash.ok ? t('admin.providerOk') : providers.deepseekFlash.configured ? t('admin.providerDown') : t('admin.providerMissing')),
          ),
        ),
      );
    } catch {
      usageBox.replaceChildren(h('h2', { class: 'h' }, t('admin.usage')), h('div', { class: 'notice bad' }, h('p', {}, t('admin.loadFailed'))));
    }
  }

  root.append(
    h('div', { class: 'row' }, h('div', {}, h('div', { class: 'mut' }, t('admin.ownerOnly')), h('h1', { class: 'h1' }, t('admin.title'))), h('a', { class: 'btn sm', href: '#/me' }, t('me.title'))),
    codesBox,
    accountsBox,
    usageBox,
  );

  return {
    el: root,
    title: t('admin.title'),
    async mount() {
      await Promise.all([loadCodes(), loadAccounts(), loadUsage()]);
      if (alive) announce(t('admin.title'));
    },
    destroy() {
      alive = false;
    },
  };
}
