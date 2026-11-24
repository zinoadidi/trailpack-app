import test from 'node:test';
import assert from 'node:assert/strict';
import { register, render, startRouter } from '../src/app/router.js';

test('a slow previous route cannot replace a newer route', async () => {
  globalThis.location = { hash: '#/fast' };
  globalThis.window = { addEventListener() {}, scrollTo() {} };
  globalThis.document = { title: '', dispatchEvent() {} };
  const container = {
    child: null, className: '',
    get firstChild() { return this.child; },
    removeChild() { this.child = null; },
    append(node) { this.child = node; },
    focus() {},
  };
  const view = (name) => ({ el: { name, querySelector: () => null } });
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  register('/fast', async () => view('fast'));
  register('/slow', async () => { await pending; return view('slow'); });
  await startRouter(container);
  location.hash = '#/slow';
  const oldRender = render();
  location.hash = '#/fast';
  await render();
  release();
  await oldRender;
  assert.equal(container.child.name, 'fast');
});
