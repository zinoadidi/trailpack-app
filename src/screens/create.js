// Create account, reachable only after a valid code was checked.

import { state, t } from '../app/state.js';
import { h, mark } from '../app/ui.js';
import { navigate } from '../app/router.js';
import { startSession } from '../app/session.js';
import { normaliseCode } from './access.js';

export default function create() {
  const code = sessionStorage.getItem('trailpack.redeemCode') || '';
  const error = h('div', { hidden: true });
  const name = h('input', { id: 'name', class: 'input', autocomplete: 'name', required: true });
  const email = h('input', { id: 'email', class: 'input', type: 'email', autocomplete: 'email', required: true });
  const password = h('input', { id: 'password', class: 'input', type: 'password', autocomplete: 'new-password', minlength: 10, required: true, 'aria-describedby': 'pw-hint' });
  const submit = h('button', { class: 'btn p block', type: 'submit' }, t('create.submit'));

  async function onSubmit(e) {
    e.preventDefault();
    error.hidden = true;
    if (password.value.length < 10) {
      error.hidden = false;
      error.replaceChildren(h('p', { class: 'err' }, t('create.passwordShort')));
      password.focus();
      return;
    }
    submit.disabled = true;
    try {
      const payload = await state.api.redeem({
        code: normaliseCode(code),
        name: name.value.trim(),
        email: email.value.trim(),
        password: password.value,
        lang: state.lang,
      });
      await startSession(payload);
      sessionStorage.removeItem('trailpack.redeemCode');
      navigate('/', { replace: true });
    } catch (err) {
      error.hidden = false;
      const key = err && err.code === 'invalid_code' ? 'access.invalid' : 'create.failed';
      error.replaceChildren(h('div', { class: 'notice bad' }, h('p', {}, t(key))));
    } finally {
      submit.disabled = false;
    }
  }

  const el = h(
    'div',
    { class: 'authwrap' },
    mark(56, 'create'),
    h('div', { class: 'stack', style: { alignItems: 'flex-start', textAlign: 'left' } }, h('span', { class: 'chip m' }, '✓ ' + t('create.codeAccepted'))),
    h('div', { style: { textAlign: 'left' } }, h('h1', { class: 'h1 disp' }, t('create.title')), h('p', { class: 'tagline' }, t('create.subtitle'))),
    h(
      'form',
      { onsubmit: onSubmit },
      h('div', { class: 'field' }, h('label', { for: 'name' }, t('create.name')), name),
      h('div', { class: 'field' }, h('label', { for: 'email' }, t('create.email')), email),
      h('div', { class: 'field' }, h('label', { for: 'password' }, t('create.password')), password, h('p', { class: 'hint', id: 'pw-hint' }, t('create.passwordHint'))),
      error,
      submit,
    ),
    h(
      'div',
      { class: 'panel', style: { textAlign: 'left' } },
      h('div', { class: 'row' }, h('b', { class: 'small' }, t('create.planTitle')), h('span', { class: 'chip o' }, '✦ ' + t('me.modelMuse'))),
      h('p', { class: 'mut', style: { marginTop: '6px' } }, t('create.planBody')),
    ),
    h('p', { class: 'mut small' }, t('create.privacy')),
    code ? null : h('p', { class: 'mut small' }, t('create.trouble')),
  );

  return {
    el,
    title: t('create.title'),
    tabs: false,
    mount() {
      name.focus({ preventScroll: true });
    },
  };
}
