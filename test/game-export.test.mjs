import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { ankiFile, buildExport, cheatSheet, exportCampOptions, exportFileName, exportFooter, mdEscape, packCamps, printDocument, studyGuide, tsvCell } from '../src/game/export.js';
import { prepareExport } from '../src/game/export-run.js';

const EN = JSON.parse(await readFile(fileURLToPath(new URL('../src/i18n/en.json', import.meta.url)), 'utf8'));
const DATE = new Date(2026, 4, 6, 12, 0);

const PACK = {
  id: 'pm-intro',
  title: 'Intro to project management',
  goal: 'Get comfortable with the basics',
  topics: [
    { id: 'scope', title: 'Scope' },
    { id: 'risk', title: 'Risk' },
  ],
  facts: [
    { id: 'f1', topicId: 'scope', text: 'A scope statement lists what is in and out of the project.', importance: 3, source: { name: 'notes.md', page: 2 }, variants: [{ type: 'flash', front: 'What does a scope statement do?', back: 'Lists what is in and out.' }] },
    { id: 'f2', topicId: 'scope', text: 'A change request needs an impact estimate.', importance: 2, source: { name: 'notes.md' } },
    { id: 'f3', topicId: 'risk', text: 'A risk register tracks likelihood and impact.', importance: 3, source: { name: 'notes.md', page: 4 } },
    { id: 'f4', text: 'Float is the spare time in a schedule.', importance: 1, source: { name: 'notes.md' } },
  ],
};

test('camps group facts by topic, in order, with orphans last', () => {
  const camps = packCamps(PACK);
  assert.deepEqual(camps.map((c) => c.id), ['scope', 'risk', 'other']);
  assert.equal(camps[0].facts.length, 2);
  assert.equal(camps[2].facts[0].id, 'f4');
  assert.deepEqual(packCamps({}), []);
});

test('the study guide has a contents list, one section per camp and a footer', () => {
  const md = studyGuide(PACK, { date: DATE, lensTitle: 'Oral exam', lang: 'en' });
  assert.ok(md.startsWith('# Intro to project management'));
  assert.ok(md.includes('## Contents'));
  assert.ok(md.includes('1. Scope (2)'));
  assert.ok(md.includes('2. Risk (1)'));
  assert.ok(md.includes('3. Other (1)'));
  assert.ok(md.includes('> Source: notes.md p.2'));
  assert.ok(md.includes('(f1)'), 'the fact id is there for an explain-the-miss link');
  assert.ok(md.includes('Lens: Oral exam'));
  assert.ok(md.includes('2026-05-06'));
});

test('a single camp export only contains that camp', () => {
  const md = studyGuide(PACK, { campId: 'risk', date: DATE });
  assert.ok(md.includes('Risk'));
  assert.ok(!md.includes('Scope'));
  assert.ok(!md.includes('Float is the spare time'));
});

test('the cheat sheet keeps only the top facts, one line each', () => {
  const sheet = cheatSheet(PACK, { date: DATE, limit: 2 });
  const bullets = sheet.split('\n').filter((line) => line.startsWith('- '));
  assert.equal(bullets.length, 2);
  assert.ok(bullets.every((line) => !line.includes('\n')));
  assert.ok(sheet.includes('notes.md'));
  assert.ok(!sheet.includes('A change request needs an impact estimate'), 'low importance facts are left out');
  assert.equal(cheatSheet({ facts: [] }, { date: DATE }).includes('_Nothing to summarise yet._'), true);
});

test('the Anki file is plain TSV, front, back and tags, no header', () => {
  const tsv = ankiFile(PACK);
  const rows = tsv.trimEnd().split('\n');
  assert.equal(rows.length, 4);
  for (const row of rows) assert.equal(row.split('\t').length, 3, 'three columns, tabs only as separators');
  assert.equal(rows[0].split('\t')[0], 'What does a scope statement do?');
  assert.ok(rows[0].split('\t')[1].includes('Lists what is in and out.'));
  assert.match(rows[0].split('\t')[2], /^scope pm-intro$/);
  assert.ok(!tsv.startsWith('Front'), 'no header row, Anki does not want one');
});

test('TSV cells never carry a tab or a newline', () => {
  assert.equal(tsvCell('a\tb\nc'), 'a b c');
  assert.equal(tsvCell('say "hi"'), 'say ""hi""');
});

test('markdown escapes the characters that would turn into markup', () => {
  assert.equal(mdEscape('a*b_c[d]'), 'a\\*b\\_c\\[d\\]');
  assert.equal(mdEscape(null), '');
});

test('the print document is a complete html page with no script', () => {
  const html = printDocument(PACK, { date: DATE, lang: 'en' });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('<h2>Scope</h2>'));
  assert.ok(!html.includes('<script'), 'nothing executable in the print sheet');
  assert.ok(html.includes('@page'), 'a print page rule is present');
  assert.ok(html.includes('2026-05-06'));
});

test('pack text is escaped in the print document', () => {
  const html = printDocument({ title: 'A <b>bold</b> pack', facts: [{ id: 'f', text: 'x < y & z' }] });
  assert.ok(html.includes('A &lt;b&gt;bold&lt;/b&gt; pack'));
  assert.ok(html.includes('x &lt; y &amp; z'));
});

test('file names are safe and named for the format', () => {
  assert.equal(exportFileName('guide', PACK, { date: DATE }), 'intro-to-project-management-all-2026-05-06.md');
  assert.equal(exportFileName('anki', PACK, { campId: 'risk', date: DATE }), 'intro-to-project-management-camp-risk-2026-05-06.tsv');
  assert.equal(exportFileName('print', {}, { date: DATE }), 'trailpack-all-2026-05-06.html');
  assert.ok(!/[^\w.-]/.test(exportFileName('guide', { title: '../../etc/passwd' }, { date: DATE })));
});

test('buildExport picks mime and builder, and refuses unknown formats', () => {
  assert.equal(buildExport('guide', PACK, { date: DATE }).mime, 'text/markdown');
  assert.equal(buildExport('anki', PACK, { date: DATE }).mime, 'text/tab-separated-values');
  assert.equal(buildExport('print', PACK, { date: DATE }).mime, 'text/html');
  assert.equal(buildExport('certificate', PACK, { date: DATE }), null, 'the certificate is drawn, not text');
  assert.equal(buildExport('nope', PACK), null);
});

test('the footer always names the pack, the Lens and the date', () => {
  assert.equal(exportFooter(PACK, { date: DATE, lensTitle: 'Plain English', lang: 'en' }), 'Intro to project management \u00b7 Lens: Plain English \u00b7 en \u00b7 2026-05-06');
  assert.equal(exportFooter({}, { date: DATE }), 'Untitled pack \u00b7 2026-05-06');
});

test('the camp picker offers all camps plus each one', () => {
  const options = exportCampOptions(PACK);
  assert.deepEqual(options[0], { id: null, title: 'All camps', facts: 4 });
  assert.deepEqual(options[1], { id: 'scope', title: 'Scope', facts: 2 });
});

test('prepareExport pays 30 points once per camp per day', () => {
  const first = prepareExport('guide', PACK, { date: DATE });
  assert.equal(first.points, 30);
  assert.equal(first.entry.camp, 'all');
  assert.equal(first.entry.day, '2026-05-06');
  const second = prepareExport('cheatsheet', PACK, { date: DATE, log: [first.entry] });
  assert.equal(second.points, 0);
  const otherCamp = prepareExport('guide', PACK, { date: DATE, campId: 'risk', log: [first.entry] });
  assert.equal(otherCamp.points, 30);
  const nextDay = prepareExport('guide', PACK, { date: new Date(2026, 4, 7), log: [first.entry] });
  assert.equal(nextDay.points, 30);
});

test('every export format has a label and a help line', () => {
  for (const key of ['export.guide', 'export.cheatsheet', 'export.anki', 'export.print', 'export.certificate']) {
    assert.ok(EN[key], key);
    assert.ok(EN[key + 'Help'], key + 'Help');
  }
});
