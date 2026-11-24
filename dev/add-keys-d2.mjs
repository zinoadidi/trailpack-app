// Add D's progress keys to all five catalogues. Idempotent, wired. prefix only.
import { readFile, writeFile } from 'node:fs/promises';

const KEYS = {
  'wired.readiness': {
    en: 'Readiness',
    et: 'Valmisolek',
    es: 'Preparación',
    fr: 'Préparation',
    fi: 'Valmius',
  },
  'wired.readinessValue': {
    en: '{score}%',
    et: '{score}%',
    es: '{score}%',
    fr: '{score} %',
    fi: '{score}%',
  },
  'wired.readinessA11y': {
    en: 'Readiness {score} percent',
    et: 'Valmisolek {score} protsenti',
    es: 'Preparación {score} por ciento',
    fr: 'Préparation {score} pour cent',
    fi: 'Valmius {score} prosenttia',
  },
  'wired.readinessTrail': {
    en: 'Recall, camps and checkpoints from your Trail, weighted by when you last studied.',
    et: 'Meenutus, laagrid ja kontrollpunktid sinu rajal, kaalutud viimase õppimise järgi.',
    es: 'Recuerdo, campamentos y controles de tu ruta, ponderados por cuándo estudiaste.',
    fr: 'Rappel, camps et contrôles de votre parcours, pondérés par votre dernière révision.',
    fi: 'Muisti, leirit ja tarkistuspisteet polultasi, painotettuna viime opiskelusta.',
  },
  'wired.readinessNoTrail': {
    en: 'No Trail plan yet, so this is recall only.',
    et: 'Rada puudub, seega see on ainult meenutus.',
    es: 'Aún no hay ruta, así que esto es solo recuerdo.',
    fr: 'Pas encore de parcours : seulement le rappel.',
    fi: 'Polkua ei vielä ole, joten tämä on vain muisti.',
  },
  'wired.mastery': {
    en: 'Mastery by topic',
    et: 'Oskus teemade kaupa',
    es: 'Dominio por tema',
    fr: 'Maîtrise par thème',
    fi: 'Hallinta aiheittain',
  },
  'wired.masteredTotal': {
    en: '{done} of {total} mastered',
    et: '{done}/{total} selge',
    es: '{done} de {total} dominados',
    fr: '{done} sur {total} maîtrisés',
    fi: '{done}/{total} hallussa',
  },
  'wired.topicA11y': {
    en: '{title}: {done} of {total} facts mastered',
    et: '{title}: {total}-st faktist {done} selge',
    es: '{title}: {done} de {total} datos dominados',
    fr: '{title} : {done} faits sur {total} maîtrisés',
    fi: '{title}: {done}/{total} faktaa hallussa',
  },
  'wired.noMastery': {
    en: 'Finish your first bite and your progress appears here.',
    et: 'Lõpeta esimene suutäis ja edenemine ilmub siia.',
    es: 'Termina tu primer bocado y tu progreso aparecerá aquí.',
    fr: 'Terminez votre première bouchée et votre progression apparaîtra ici.',
    fi: 'Viimeistele ensimmäinen jakso, niin edistyminen näkyy täällä.',
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
