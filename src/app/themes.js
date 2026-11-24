// Theme resolution: four themes plus "system". Pure logic, no DOM, so the
// allowed values and the system mapping can be tested directly.

/** Values the account and `/me` accept, in picker order. */
export const THEME_IDS = ['dark', 'light', 'ocean', 'matcha', 'system'];

/** The concrete themes and the palette each one uses for its preview tile. */
export const THEMES = [
  { id: 'dark', name: 'Grape Night', scheme: 'dark', labelKey: 'me.themeDark', page: '#0C061D', surface: '#221446', raised: '#2F1D5E', spark: '#FF5C8A', volt: '#C6F432', text: '#FFF7F0' },
  { id: 'light', name: 'Sunrise', scheme: 'light', labelKey: 'me.themeLight', page: '#EFDFC8', surface: '#FFFFFF', raised: '#EEE0FF', spark: '#E8286B', volt: '#5A8C00', text: '#1D0F44' },
  { id: 'ocean', name: 'Deep Ocean', scheme: 'dark', labelKey: 'me.themeOcean', page: '#031020', surface: '#0C2A47', raised: '#123A5F', spark: '#19D3C5', volt: '#8BE04E', text: '#EAF7FF' },
  { id: 'matcha', name: 'Matcha Pop', scheme: 'light', labelKey: 'me.themeMatcha', page: '#DDEBC4', surface: '#FFFFFF', raised: '#E2F0C8', spark: '#D44A0B', volt: '#5E8300', text: '#14301A' },
];

export const THEME_PREVIEW = THEMES;

/** A theme id, or `system` when the value is unknown or missing. */
export function normaliseTheme(value) {
  return THEME_IDS.includes(value) ? value : 'system';
}

/** "system" resolves to Grape Night (dark) or Sunrise (light). */
export function systemTheme(prefersLight) {
  return prefersLight ? 'light' : 'dark';
}

export function resolveTheme(pref, prefersLight) {
  const value = normaliseTheme(pref);
  return value === 'system' ? systemTheme(prefersLight) : value;
}

/** A concrete theme by id. */
export function themeById(id) {
  return THEMES.find((theme) => theme.id === id) || null;
}

export const THEME_COLOR = { dark: '#0C061D', ocean: '#031020', light: '#EFDFC8', matcha: '#DDEBC4' };
