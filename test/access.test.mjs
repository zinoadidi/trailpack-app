import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

class FakeNode {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.attrs = {}; this.children = []; this.events = {}; this.dataset = {}; this.style = {}; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  addEventListener(name, fn) { this.events[name] = fn; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  focus() {}
  get firstElementChild() { return new FakeNode('svg'); }
}
globalThis.Node = FakeNode;
globalThis.document = { createElement: (tag) => new FakeNode(tag), createTextNode: (text) => ({ text }) };
globalThis.location = { hash: '' };
const stored = new Map();
globalThis.sessionStorage = { setItem: (key, value) => stored.set(key, value), getItem: (key) => stored.get(key) };

const { default: access, normaliseCode, isValidCode } = await import('../src/screens/access.js');
const { state } = await import('../src/app/state.js');
const find = (node, predicate) => predicate(node) ? node : (node.children || []).map((child) => find(child, predicate)).find(Boolean);

test('custom codes and generated codes are accepted and normalised for redemption', () => {
  for (const [input, expected] of [[' cake2010 ', 'cake2010'], ['CAKE2024', 'cake2024'], ['Spring-Class', 'spring-class'], ['trl-2345-6789-abcd', 'TRL-2345-6789-ABCD']]) {
    assert.equal(normaliseCode(input), expected);
    assert.equal(isValidCode(input), true);
    assert.equal(normaliseCode(expected), expected, 'account creation preserves the checked code');
  }
  for (const input of ['abc', '-leading', 'trl-spring', 'x'.repeat(41)]) assert.equal(isValidCode(input), false, input);
});

test('the join form sends a custom code to the server and continues to account creation', async () => {
  let checked; state.api = { checkCode: async (code) => { checked = code; } };
  const view = access(); const input = find(view.el, (n) => n.attrs?.id === 'code');
  const form = find(view.el, (n) => n.tagName === 'FORM');
  input.value = 'CAKE2024';
  await form.events.submit({ preventDefault() {} });
  assert.equal(checked, 'cake2024');
  assert.equal(sessionStorage.getItem('trailpack.redeemCode'), 'cake2024');
  assert.equal(location.hash, '#/create');
});

test('the join hint does not imply that only generated TRL codes are allowed', () => {
  for (const lang of ['en', 'es', 'fr', 'et', 'fi']) {
    const messages = JSON.parse(fs.readFileSync(new URL(`../src/i18n/${lang}.json`, import.meta.url), 'utf8'));
    assert.doesNotMatch(messages['access.codeFormat'], /TRL-XXXX-XXXX-XXXX/, lang);
    assert.doesNotMatch(messages['access.codePlaceholder'], /TRL-XXXX-XXXX-XXXX/, lang);
  }
});
