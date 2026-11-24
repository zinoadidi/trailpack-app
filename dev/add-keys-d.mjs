// Add D's keys to all five catalogues. Small, idempotent, under the wired./zip. prefix.
import { readFile, writeFile } from 'node:fs/promises';

const KEYS = {
  'lens.chip': {
    en: 'Lens: {title}',
    et: 'Lääts: {title}',
    es: 'Lente: {title}',
    fr: 'Objectif : {title}',
    fi: 'Linssi: {title}',
  },
  'lens.pickerLabel': {
    en: 'Choose a Lens',
    et: 'Vali lääts',
    es: 'Elige una lente',
    fr: 'Choisir un objectif',
    fi: 'Valitse linssi',
  },
  'lens.nowUsing': {
    en: 'Now using {title}',
    et: 'Kasutusel {title}',
    es: 'Ahora usas {title}',
    fr: 'Vous utilisez {title}',
    fi: 'Käytössä {title}',
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
