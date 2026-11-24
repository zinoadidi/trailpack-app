// Batch 3 of B's i18n keys: the Trail home (prefix trailhome.). Run through
// scripts/i18n-batch.mjs.

export const PREFIXES = ['trailhome.'];

export const STRINGS = {
  'trailhome.campLabel': {
    en: 'Camp {number}, {title}. State: {state}',
    et: 'Laager {number}, {title}. Olek: {state}',
    es: 'Campamento {number}, {title}. Estado: {state}',
    fr: 'Camp {number}, {title}. État : {state}',
    fi: 'Leiri {number}, {title}. Tila: {state}',
  },
  'trailhome.pathLabel': {
    en: 'Your camps',
    et: 'Sinu laagrid',
    es: 'Tus campamentos',
    fr: 'Vos camps',
    fi: 'Leirisi',
  },
  'trailhome.walkNext': {
    en: '{remaining, plural, one {# step left today.} other {# steps left today.}}',
    et: '{remaining, plural, one {Täna on jäänud üks samm.} other {Täna on jäänud # sammu.}}',
    es: '{remaining, plural, one {Queda un paso hoy.} other {Quedan # pasos hoy.}}',
    fr: '{remaining, plural, one {Encore un pas aujourd’hui.} other {Encore # pas aujourd’hui.}}',
    fi: '{remaining, plural, one {Yksi askel jäljellä tänään.} other {# askelta jäljellä tänään.}}',
  },
  'trailhome.overdue': {
    en: 'Past the deadline',
    et: 'Tähtaeg on möödas',
    es: 'Plazo superado',
    fr: 'Délai dépassé',
    fi: 'Määräaika mennyt',
  },
  'trailhome.deadlineHelp': {
    en: 'Set a deadline to let the trail plan your days. Without one, reviews simply come when they are due.',
    et: 'Sea tähtaeg, et rada saaks sinu päevi planeerida. Ilma selleta tulevad kordamised siis, kui need on õiged.',
    es: 'Pon una fecha límite para que el sendero planifique tus días. Sin ella, los repasos llegan cuando toca.',
    fr: 'Fixez une échéance pour que le sentier planifie vos journées. Sans elle, les révisions arrivent quand elles sont dues.',
    fi: 'Aseta määräaika, niin polku suunnittelee päiväsi. Ilman sitä kertaukset tulevat kun ne erääntyvät.',
  },
  'trailhome.campsDone': {
    en: '{done} of {total} camps summited',
    et: '{done}, kokku {total} laagrit tipus',
    es: '{done} de {total} campamentos coronados',
    fr: '{done} sur {total} camps au sommet',
    fi: '{done} / {total} leiriä huipulla',
  },
};
