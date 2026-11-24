// The Trail home widgets (src/screens/trail-home-widgets.js) are small DOM
// builders. There is no jsdom in this repo, so the test uses a minimal stub
// of the few DOM calls they make and checks the attributes that matter: a
// label for assistive tech, the percent clamped to 0..100, and no colour.

import test from 'node:test';
import assert from 'node:assert/strict';

class FakeNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.attrs = {};
    this.children = [];
    this.style = {};
    this.className = '';
    this.textContent = '';
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }
  append(...items) {
    this.children.push(...items);
  }
}

globalThis.Node = FakeNode;
globalThis.document = { createElement: (tag) => new FakeNode(tag), createTextNode: (text) => ({ text: String(text) }) };

const { ring, hereMarker } = await import('../src/screens/trail-home-widgets.js');

test('the readiness ring shows the number and a label', () => {
  const el = ring(78, '78% ready');
  assert.equal(el.className, 'ringwrap');
  assert.equal(el.attrs.role, 'img');
  assert.equal(el.attrs['aria-label'], '78% ready');
  assert.equal(el.style['--pct'], '78');
  assert.ok(el.children.some((child) => child.className === 'ringinner'));
});

test('the ring clamps a bad percent instead of drawing it', () => {
  assert.equal(ring(140).attrs['aria-label'], '100%');
  assert.equal(ring(-3).attrs['aria-label'], '0%');
  assert.equal(ring(NaN).attrs['aria-label'], '0%');
  assert.equal(ring(140).style['--pct'], '100');
});

test('the marker is decoration only for a screen reader', () => {
  const el = hereMarker('Camp 2');
  assert.equal(el.attrs['aria-hidden'], 'true');
  assert.equal(el.attrs.title, 'Camp 2');
  assert.deepEqual(el.children.map((child) => child.text), ['\u25bc']);
});
