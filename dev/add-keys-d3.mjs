// Add D's ZIP keys to all five catalogues. Idempotent, zip. prefix only.
import { readFile, writeFile } from 'node:fs/promises';

const KEYS = {
  'zip.all': {
    en: 'Download all (ZIP)',
    et: 'Laadi kõik alla (ZIP)',
    es: 'Descargar todo (ZIP)',
    fr: 'Tout télécharger (ZIP)',
    fi: 'Lataa kaikki (ZIP)',
  },
  'zip.allHelp': {
    en: 'The study guide, the cheat sheet and the Anki file in one archive.',
    et: 'Õppejuhend, petuleht ja Anki fail ühes arhiivis.',
    es: 'La guía, la hoja de referencia y el archivo de Anki en un solo ZIP.',
    fr: 'Le guide, la fiche mémo et le fichier Anki dans une seule archive.',
    fi: 'Opas, lunttilappu ja Anki-tiedosto yhdessä paketissa.',
  },
  'zip.download': {
    en: 'Download ZIP',
    et: 'Laadi ZIP',
    es: 'Descargar ZIP',
    fr: 'Télécharger le ZIP',
    fi: 'Lataa ZIP',
  },
  'zip.downloaded': {
    en: 'ZIP with {count, plural, one {# file} other {# files}} saved to your downloads',
    et: 'ZIP {count, plural, one {# failiga} other {# failiga}} salvestatud allalaadimistesse',
    es: 'ZIP con {count, plural, one {# archivo} other {# archivos}} guardado en tus descargas',
    fr: 'ZIP avec {count, plural, one {# fichier} other {# fichiers}} enregistré dans vos téléchargements',
    fi: 'ZIP, jossa {count, plural, one {# tiedosto} other {# tiedostoa}}, tallennettu latauksiin',
  },
};

for (const lang of ['en', 'et', 'es', 'fr', 'fi']) {
  const path = `src/i18n/${lang}.json`;
  const data = JSON.parse(await readFile(path, 'utf8'));
  let added = 0;
  for (const [key, values] of Object.entries(KEYS)) {
    if (key in data) continue;
    data[key] = values[lang];
    added += 1;
    if (lang !== 'en' && Array.isArray(data._review)) data._review.push(key);
  }
  await writeFile(path, JSON.stringify(data, null, 2) + '\n');
  console.log(lang, 'added', added);
}
