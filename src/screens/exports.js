// Exports (#/exports): Markdown guide, cheat sheet, Anki file, a ZIP with all
// three, print view and the Summit certificate, each per Camp. All building is
// done by the pure modules in src/game and src/export; this screen only
// downloads, prints and draws.

import { state, t } from '../app/state.js';
import { h, toast, announce } from '../app/ui.js';
import { prepareExport, exportCampOptions } from '../game/export-run.js';
import { canIssueCertificate, certificateData, certificateFileName, drawCertificate, CERT_HEIGHT, CERT_WIDTH } from '../game/certificate.js';
import { noteExport } from '../game/profile.js';
import { readProfile, runProfileAction } from '../game/screen-helpers.js';
import { emptyLens } from '../game/lens.js';
import { zipBundle } from '../export/bundle.js';
import { resolveActivePack } from '../study/store.js';
import { lensBar, lensChip, lensState } from './lens-bar.js';

const FORMATS = ['guide', 'cheatsheet', 'anki', 'print'];

function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: fileName, style: { display: 'none' } });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function download(text, fileName, mime) {
  saveBlob(new Blob([text], { type: mime + ';charset=utf-8' }), fileName);
}

function printHtml(text) {
  const frame = h('iframe', { style: { position: 'fixed', width: '0', height: '0', border: '0', opacity: '0' }, sandbox: 'allow-modals', 'aria-hidden': 'true' });
  document.body.append(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(text);
  doc.close();
  frame.contentWindow.focus();
  frame.contentWindow.print();
  setTimeout(() => frame.remove(), 3000);
}

/** Read the live theme colours so the PNG follows the chosen theme. */
function palette() {
  const css = getComputedStyle(document.documentElement);
  const read = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  return {
    page: read('--page', '#000'),
    surface: read('--surface', '#111'),
    text: read('--text', '#fff'),
    muted: read('--muted', '#888'),
    spark: read('--spark', '#f0f'),
    volt: read('--volt', '#0f0'),
    summit: read('--summit', '#ff0'),
    orchid: read('--orchid', '#80f'),
  };
}

/** The active Pack in the export shape (topics and facts on one object). */
async function exportPack() {
  try {
    const bundle = await resolveActivePack(state.store);
    if (bundle && bundle.pack) return { ...bundle.pack, topics: bundle.topics || [], facts: bundle.facts || [] };
  } catch {
    /* fall back to the meta copy below */
  }
  const row = await state.store.get('meta', 'active-pack').catch(() => null);
  return (row && row.value) || null;
}

export default function exportsScreen() {
  const root = h('div', { class: 'stack' });
  const body = h('div', { class: 'stack' });
  root.append(h('h1', { class: 'h1' }, t('export.title')), body);
  let campChoice = null;

  async function render() {
    const data = await exportPack();
    if (!data) {
      body.replaceChildren(h('div', { class: 'panel' }, h('p', { class: 'mut' }, t('export.noPack'))));
      return;
    }
    const options = exportCampOptions(data);
    const chips = h('div', { class: 'seg', role: 'group', 'aria-label': t('export.camp') });
    for (const option of options) {
      chips.append(
        h(
          'button',
          {
            type: 'button',
            'aria-pressed': String(campChoice === option.id),
            onclick: () => {
              campChoice = option.id;
              render();
            },
          },
          option.id ? option.title : t('export.allCamps'),
        ),
      );
    }
    const profile = await readProfile();
    const { lens } = await lensState(emptyLens());
    const rows = FORMATS.map((format) => {
      const ready = prepareExport(format, data, { campId: campChoice, log: profile.exports, lensTitle: lens.title, lang: state.lang });
      const label = t('export.' + format);
      return h(
        'div',
        { class: 'rowitem' },
        h('span', {}, h('b', {}, label), h('span', { class: 'mut small', style: { display: 'block' } }, t('export.' + format + 'Help'))),
        h(
          'button',
          {
            class: 'btn sm',
            type: 'button',
            onclick: async () => {
              try {
                if (format === 'print') {
                  printHtml(ready.text);
                  toast(t('export.printStarted'));
                } else {
                  download(ready.text, ready.fileName, ready.mime);
                  toast(t('export.downloaded'));
                }
                if (ready.points > 0) {
                  await runProfileAction((current) => noteExport(current, ready.entry, ready.points));
                  toast(t('export.pointsEarned', { points: ready.points }));
                }
                render();
              } catch {
                toast(t('export.failed'));
              }
            },
          },
          t('export.download'),
        ),
      );
    });
    body.replaceChildren(
      h(
        'section',
        { class: 'panel stack' },
        h('div', { class: 'row' }, h('b', {}, data.title), lensChip(lens)),
        chips,
        h('p', { class: 'mut small' }, t('export.pointsOnce')),
        h('div', { class: 'rows' }, ...rows),
        zipRow(data, lens),
        lensBar(lens, { items: [], onChange: render }),
      ),
      certificateSection(data, profile),
    );
  }

  /** Download all: guide plus cheat sheet plus Anki in one archive. */
  function zipRow(data, lens) {
    return h(
      'div',
      { class: 'rowitem' },
      h('span', {}, h('b', {}, t('zip.all')), h('span', { class: 'mut small', style: { display: 'block' } }, t('zip.allHelp'))),
      h(
        'button',
        {
          class: 'btn sm',
          type: 'button',
          onclick: async () => {
            try {
              const { fileName, entries, bytes } = zipBundle(data, { campId: campChoice, lensTitle: lens.title, lang: state.lang });
              if (!entries.length) {
                toast(t('export.failed'));
                return;
              }
              saveBlob(new Blob([bytes], { type: 'application/zip' }), fileName);
              toast(t('zip.downloaded', { count: entries.length }));
            } catch {
              toast(t('export.failed'));
            }
          },
        },
        t('zip.download'),
      ),
    );
  }

  function certificateSection(data, profile) {
    const trail = {
      packTitle: data.title,
      learnerName: state.user?.name,
      startedAt: data.startedAt || data.createdAt,
      finishedAt: new Date(),
      points: profile.points,
      lensCount: data.lensCount || 1,
      campCount: (data.topics || []).length,
    };
    const ready = canIssueCertificate({ camps: data.camps, mockPassed: data.mockPassed !== false, summit: data.summit });
    const canvas = h('canvas', { width: CERT_WIDTH, height: CERT_HEIGHT, role: 'img', 'aria-label': t('certificate.a11y', { name: trail.learnerName || '', pack: data.title, points: profile.points, days: certificateData(trail).days }), class: 'cert-canvas' });
    if (ready) {
      try {
        drawCertificate(canvas.getContext('2d'), certificateData(trail), palette());
      } catch {
        toast(t('certificate.failed'));
      }
    }
    return h(
      'section',
      { class: 'panel stack' },
      h('h2', { class: 'h', style: { fontSize: '17px' } }, t('certificate.title')),
      h('p', { class: 'mut small' }, ready ? t('certificate.ready') : t('certificate.locked')),
      ready ? canvas : null,
      ready
        ? h(
            'button',
            {
              class: 'btn p sm',
              type: 'button',
              onclick: () => {
                canvas.toBlob((blob) => {
                  if (!blob) {
                    toast(t('certificate.failed'));
                    return;
                  }
                  saveBlob(blob, certificateFileName(certificateData(trail)));
                  toast(t('certificate.saved'));
                }, 'image/png');
              },
            },
            t('certificate.save'),
          )
        : null,
    );
  }

  render();

  return {
    el: root,
    title: t('export.title'),
    async mount() {
      await render();
      announce(t('export.title'));
    },
  };
}
