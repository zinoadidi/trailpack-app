// Add D's Trail + data hygiene keys to all five catalogues. Idempotent, wired. prefix only.
import { readFile, writeFile } from 'node:fs/promises';

const KEYS = {
  'wired.changeLens': {
    en: 'Change Lens',
    et: 'Vaheta läätse',
    es: 'Cambiar lente',
    fr: 'Changer d’objectif',
    fi: 'Vaihda linssiä',
  },
  'wired.needsReview': {
    en: 'Needs review',
    et: 'Vajab ülevaatamist',
    es: 'Necesita revisión',
    fr: 'À revoir',
    fi: 'Vaatii tarkistusta',
  },
  'wired.reviewNoSource': {
    en: 'No source citation',
    et: 'Allikat pole viidatud',
    es: 'Sin cita de la fuente',
    fr: 'Aucune source citée',
    fi: 'Ei lähdeviitettä',
  },
  'wired.reviewLowConfidence': {
    en: 'Low confidence',
    et: 'Madal kindlus',
    es: 'Confianza baja',
    fr: 'Confiance faible',
    fi: 'Matala varmuus',
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
