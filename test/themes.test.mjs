// The four themes plus "system": the allowed values, the OS mapping and the
// CSS blocks themselves. Pure logic apart from reading one stylesheet file in
// the test, no DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { THEME_IDS, THEMES, THEME_COLOR, normaliseTheme, resolveTheme, systemTheme } from '../src/app/themes.js';

const CSS = fileURLToPath(new URL('../styles/app.css', import.meta.url));
const css = await readFile(CSS, 'utf8');
const EN = JSON.parse(await readFile(fileURLToPath(new URL('../src/i18n/en.json', import.meta.url)), 'utf8'));

/**
 * Pull every declaration of one theme block. The dark theme is shared by `:root`
 * and `[data-theme=dark]`; the others have their own selector.
 */
function themeBlock(name) {
  const selector = name === 'dark' ? ':root, [data-theme=dark]' : `[data-theme=${name}]`;
  const lineStart = css.search(new RegExp('^' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{', 'm'));
  assert.ok(lineStart >= 0, `styles/app.css has a ${selector} block`);
  const open = css.indexOf('{', lineStart);
  const close = css.indexOf('}', open);
  const body = css.slice(open + 1, close);
  const vars = new Map();
  for (const [, key, value] of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) vars.set(key, value.trim());
  return vars;
}

test('the allowed theme values are dark, light, ocean, matcha and system', () => {
  assert.deepEqual([...THEME_IDS].sort(), ['dark', 'light', 'matcha', 'ocean', 'system']);
  assert.deepEqual(THEMES.map((t) => t.id), ['dark', 'light', 'ocean', 'matcha']);
});

test('unknown or missing theme values fall back to system', () => {
  assert.equal(normaliseTheme('ocean'), 'ocean');
  assert.equal(normaliseTheme('neon'), 'system');
  assert.equal(normaliseTheme(undefined), 'system');
  assert.equal(normaliseTheme(null), 'system');
});

test('system resolves to Grape Night (dark) or Sunrise (light)', () => {
  assert.equal(systemTheme(true), 'light');
  assert.equal(systemTheme(false), 'dark');
  assert.equal(resolveTheme('system', true), 'light');
  assert.equal(resolveTheme('system', false), 'dark');
  // A concrete theme never follows the OS.
  assert.equal(resolveTheme('ocean', true), 'ocean');
  assert.equal(resolveTheme('matcha', false), 'matcha');
  assert.equal(resolveTheme('dark', true), 'dark');
});

test('saved theme IDs show the approved palette directions', () => {
  const pages = { dark: '#0B0716', light: '#FFF6E9', ocean: '#2E3440', matcha: '#F5F7EE' };
  for (const [id, page] of Object.entries(pages)) {
    assert.equal(THEMES.find((theme) => theme.id === id).page, page);
    assert.equal(resolveTheme(id, false), id);
  }
});

test('theme picker displays the approved names in every locale', async () => {
  for (const locale of ['en', 'et', 'es', 'fr', 'fi']) {
    const strings = JSON.parse(await readFile(new URL(`../src/i18n/${locale}.json`, import.meta.url), 'utf8'));
    for (const theme of THEMES) {
      assert.equal(strings[theme.labelKey], theme.name, `${locale}: ${theme.id}`);
    }
  }
});

const luminance = (colour) => {
  const channels = colour.slice(1).match(/../g).map((c) => parseInt(c, 16) / 255)
    .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};

test('primary button text has at least 4.5:1 contrast in every theme', () => {
  for (const theme of THEMES) {
    const block = themeBlock(theme.id);
    const a = luminance(block.get('--spark'));
    const b = luminance(block.get('--on-spark'));
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    assert.ok(ratio >= 4.5, `${theme.id} primary contrast is ${ratio.toFixed(2)}:1`);
  }
});

test('normal and muted text remain readable on page and surface colours', () => {
  for (const theme of THEMES) {
    const block = themeBlock(theme.id);
    for (const text of ['--text', '--muted']) {
      for (const background of ['--page', '--surface', '--raised']) {
        const a = luminance(block.get(text));
        const b = luminance(block.get(background));
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        assert.ok(ratio >= 4.5, `${theme.id} ${text} on ${background}: ${ratio.toFixed(2)}:1`);
      }
    }
  }
});

test('every concrete theme has its own CSS block with the same colour variables', () => {
  // Fonts and radius are theme independent and only set on :root.
  const UNTHEMED = new Set(['--font-body', '--font-head', '--font-mono', '--radius']);
  const dark = themeBlock('dark');
  for (const theme of THEMES) {
    const block = themeBlock(theme.id);
    assert.ok(block.size > 20, `${theme.id} carries the full token set`);
    const missing = [...dark.keys()].filter((key) => !UNTHEMED.has(key) && !block.has(key));
    assert.deepEqual(missing, [], `${theme.id} is missing ${missing.join(', ')}`);
  }
});

test('themes differ from each other in page, text and primary colour', () => {
  for (const a of THEMES) {
    for (const b of THEMES) {
      if (a.id === b.id) continue;
      const pa = themeBlock(a.id);
      const pb = themeBlock(b.id);
      for (const key of ['--page', '--text', '--raised', '--spark']) {
        assert.notEqual(pa.get(key), pb.get(key), `${a.id} and ${b.id} share ${key}`);
      }
    }
  }
});

test('the preview tiles use the same colours as the CSS blocks', () => {
  for (const theme of THEMES) {
    const block = themeBlock(theme.id);
    assert.equal(theme.page, block.get('--page'), theme.id + ' page colour');
    assert.equal(theme.surface, block.get('--surface'), theme.id + ' surface colour');
    assert.equal(theme.spark, block.get('--spark'), theme.id + ' spark colour');
    assert.equal(theme.text, block.get('--text'), theme.id + ' text colour');
    assert.equal(theme.raised, block.get('--raised'), theme.id + ' raised colour');
    assert.equal(THEME_COLOR[theme.id], theme.page, theme.id + ' browser theme colour');
  }
});

test('each theme has a name and a translated label', () => {
  for (const theme of THEMES) {
    assert.ok(theme.name.length > 0);
    assert.ok(typeof EN[theme.labelKey] === 'string' && EN[theme.labelKey].length > 0, theme.labelKey + ' has text');
  }
  for (const key of ['me.themeSystem', 'me.themeHelp', 'me.themeSystemHelp', 'a11y.themeGroup']) {
    assert.ok(EN[key], key + ' is in the catalogue');
  }
});

test('no component hard codes a colour outside the token blocks', () => {
  // Strip every theme token block, then look for colours.
  const stripped = css
    .replace(/:root,[^{]*\{[^}]*\}/g, '')
    .replace(/^\[data-theme=[a-z]+\]\s*\{[^}]*\}/gm, '')
    .replace(/^\[data-theme=[a-z]+\]\s*\{[^}]*\}/gm, '');
  const hex = stripped.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual(hex, [], 'hard coded hex colours outside the token blocks');
});
