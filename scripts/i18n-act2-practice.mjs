// Batch 2 of B's i18n keys: the practice screen and the activity strings
// added with it (prefix act2.). Run through scripts/i18n-batch.mjs.

export const PREFIXES = ['act2.'];

export const STRINGS = {
  'act2.practiceTitle': {
    en: 'Practice',
    et: 'Harjutamine',
    es: 'Práctica',
    fr: 'Entraînement',
    fi: 'Harjoittelu',
  },
  'act2.practiceSubtitle': {
    en: 'Drill one activity on its own. Nothing here changes your mastery, it is a warm up.',
    et: 'Harjuta ühte tegevust eraldi. Siin ei muutu meistrid, see on soojendus.',
    es: 'Practica una actividad por sí sola. Aquí no cambia tu dominio, es un calentamiento.',
    fr: 'Entraînez une activité seule. Rien ici ne change votre maîtrise : c’est un échauffement.',
    fi: 'Harjoittele yhtä aktiviteettia erikseen. Tämä ei muuta osaamistasi, se on alkulämmittely.',
  },
  'act2.practiceHelp': {
    en: 'Pick a format to drill. Only formats your Pack already has can be practised.',
    et: 'Vali harjutamiseks formaat. Harjutada saab ainult formaate, mis pakis juba on.',
    es: 'Elige un formato para practicar. Solo los formatos que ya tiene tu paquete.',
    fr: 'Choisissez un format à travailler. Seuls les formats déjà présents dans votre pack.',
    fi: 'Valitse harjoiteltava muoto. Vain paketissasi jo olevat muodot.',
  },
  'act2.practiceHave': {
    en: '{count, plural, one {# item} other {# items}}',
    et: '{count, plural, one {# üksus} other {# üksust}}',
    es: '{count, plural, one {# elemento} other {# elementos}}',
    fr: '{count, plural, one {# élément} other {# éléments}}',
    fi: '{count, plural, one {# kohde} other {# kohdetta}}',
  },
  'act2.practiceStats': {
    en: '{right} right, {wrong} wrong, best run {best}',
    et: '{right} õige, {wrong} vale, parim seeria {best}',
    es: '{right} bien, {wrong} mal, mejor racha {best}',
    fr: '{right} justes, {wrong} fausses, meilleure série {best}',
    fi: '{right} oikein, {wrong} väärin, paras putki {best}',
  },
  'act2.practiceOf': {
    en: '{index} of {total}',
    et: '{index}, kokku {total}',
    es: '{index} de {total}',
    fr: '{index} sur {total}',
    fi: '{index} / {total}',
  },
  'act2.practiceChange': {
    en: 'Change format',
    et: 'Vaheta formaati',
    es: 'Cambiar formato',
    fr: 'Changer de format',
    fi: 'Vaihda muotoa',
  },
  'act2.practiceUnavailable': {
    en: 'This format needs a few more items in the Pack. Try another one.',
    et: 'See formaat vajab pakis rohkem üksusi. Proovi teist.',
    es: 'Este formato necesita más elementos en el paquete. Prueba otro.',
    fr: 'Ce format demande plus d’éléments dans le pack. Essayez-en un autre.',
    fi: 'Tämä muoto tarvitsee pakettiin lisää kohteita. Kokeile toista.',
  },
};
