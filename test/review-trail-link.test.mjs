import test from 'node:test';
import assert from 'node:assert/strict';

class FakeNode {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.attrs = {}; this.children = []; this.style = {}; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  addEventListener() {}
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
}

globalThis.Node = FakeNode;
globalThis.document = { createElement: (tag) => new FakeNode(tag), createTextNode: (text) => ({ text: String(text) }) };

const { topicEditor } = await import('../src/screens/review-edit.js');

test('the frozen Pack review links back to the registered Trail home route', () => {
  const root = topicEditor({ pack: { id: 'p', title: 'Pack', sources: [] }, topics: [], facts: [], frozen: true });
  const all = (node) => [node, ...(node.children || []).flatMap(all)];
  const links = all(root).filter((node) => node.tagName === 'A');
  assert.equal(links.length, 1);
  assert.equal(links[0].attrs.href, '#/');
});
