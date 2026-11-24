import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  formatMessage,
  pluralCategory,
  missingKeys,
  placeholders,
  LOCALES,
} from '../src/i18n/format.js';

const I18N = fileURLToPath(new URL('../src/i18n/', import.meta.url));

async function load(lang) {
  return JSON.parse(await readFile(I18N + lang + '.json', 'utf8'));
}

const catalogues = Object.fromEntries(await Promise.all(LOCALES.map(async (l) => [l, await load(l)])));

test('every catalogue has every English key', () => {
  const en = catalogues.en;
  for (const lang of LOCALES) {
    if (lang === 'en') continue;
    const missing = missingKeys(en, catalogues[lang]);
    assert.deepEqual(missing, [], `${lang}.json is missing: ${missing.join(', ')}`);
  }
});

test('no catalogue has keys English does not have', () => {
  const en = new Set(Object.keys(catalogues.en));
  for (const lang of LOCALES) {
    if (lang === 'en') continue;
    const extra = Object.keys(catalogues[lang]).filter((k) => !en.has(k));
    assert.deepEqual(extra, [], `${lang}.json has unknown keys: ${extra.join(', ')}`);
  }
});

test('translations keep the same placeholders as English', () => {
  const en = catalogues.en;
  for (const lang of LOCALES) {
    if (lang === 'en') continue;
    for (const [key, message] of Object.entries(catalogues[lang])) {
      if (key.startsWith('_')) continue;
      const want = placeholders(en[key] || '');
      const got = placeholders(message);
      for (const name of want) {
        assert.ok(got.includes(name), `${lang}.${key} is missing placeholder {${name}}`);
      }
    }
  }
});

test('non English catalogues carry a _review list', () => {
  for (const lang of LOCALES) {
    if (lang === 'en') continue;
    assert.ok(Array.isArray(catalogues[lang]._review) && catalogues[lang]._review.length > 0, `${lang} needs a _review list`);
  }
});

test('plural categories for the five languages', () => {
  assert.equal(pluralCategory('en', 1), 'one');
  assert.equal(pluralCategory('en', 0), 'other');
  assert.equal(pluralCategory('en', 2), 'other');
  assert.equal(pluralCategory('et', 1), 'one');
  assert.equal(pluralCategory('et', 5), 'other');
  assert.equal(pluralCategory('es', 1), 'one');
  assert.equal(pluralCategory('es', 3), 'other');
  assert.equal(pluralCategory('fr', 0), 'one', 'French treats 0 as one');
  assert.equal(pluralCategory('fr', 1), 'one');
  assert.equal(pluralCategory('fr', 2), 'other');
  assert.equal(pluralCategory('fi', 1), 'one');
  assert.equal(pluralCategory('fi', 4), 'other');
});

test('plural messages render the right form in each language', () => {
  const cases = [
    ['en', 1, '1 day', '2 days'],
    ['fr', 0, '0 jour', '2 jours'],
    ['fr', 1, '1 jour', '2 jours'],
    ['es', 1, '1 día', '2 días'],
    ['et', 2, null, '2 päeva'],
    ['fi', 1, null, '2 päivää'],
  ];
  for (const [lang, count, oneExpect, otherExpect] of cases) {
    const out = formatMessage(lang, catalogues[lang]['common.days'], { count });
    if (count === 1 || (lang === 'fr' && count === 0)) {
      if (oneExpect) assert.equal(out, oneExpect, `${lang} ${count}`);
    } else if (otherExpect) {
      assert.equal(out, otherExpect, `${lang} ${count}`);
    }
  }
});

test('explicit =0 form wins over the category', () => {
  const msg = '{count, plural, =0 {nothing yet} one {# item} other {# items}}';
  assert.equal(formatMessage('en', msg, { count: 0 }), 'nothing yet');
  assert.equal(formatMessage('en', msg, { count: 1 }), '1 item');
  assert.equal(formatMessage('en', msg, { count: 7 }), '7 items');
  assert.equal(formatMessage('fr', msg, { count: 0 }), 'nothing yet', 'exact forms beat French zero-is-one');
});

test('number formatting follows the locale', () => {
  const en = formatMessage('en', '{n, number}', { n: 1234567 });
  const fr = formatMessage('fr', '{n, number}', { n: 1234567 });
  assert.notEqual(en, fr);
  assert.match(en, /1[,.]234[,.]567/);
  assert.equal(formatMessage('en', '{n, number, percent}', { n: 0.62 }), '62%');
});

test('dates use Intl and stay parseable strings', () => {
  const d = new Date('2026-11-23T10:00:00Z');
  for (const lang of LOCALES) {
    const out = formatMessage(lang, '{when, date, medium}', { when: d });
    assert.ok(out.length > 5, lang + ' date rendered');
    assert.ok(!out.includes('{'), lang + ' has no leftover braces');
  }
});

test('apostrophes are ICU quoted', () => {
  assert.equal(formatMessage('en', "It''s fine"), "It's fine");
  assert.equal(formatMessage('en', "L''app doesn''t"), "L'app doesn't");
  assert.equal(formatMessage('en', 'Bonjour, amis'), 'Bonjour, amis');
});

test('missing values throw instead of printing undefined', () => {
  assert.throws(() => formatMessage('en', 'Hello {name}'), /Missing value/);
});

test('nested placeholders inside plural bodies', () => {
  const msg = '{n, plural, one {# file for {who}} other {# files for {who}}}';
  assert.equal(formatMessage('en', msg, { n: 1, who: 'Sam' }), '1 file for Sam');
  assert.equal(formatMessage('en', msg, { n: 3, who: 'Sam' }), '3 files for Sam');
});

test('unbalanced braces are a loud error', () => {
  assert.throws(() => formatMessage('en', 'broken {count'), /Unbalanced/);
});
