// Theme resolution: four themes plus "system". Pure logic, no DOM, so the
// allowed values and the system mapping can be tested directly.

/** Values the account and `/me` accept, in picker order. */
export const THEME_IDS = ['dark', 'light', 'ocean', 'matcha', 'system'];

/** The concrete themes and the palette each one uses for its preview tile. */
export const THEMES = [
  { id: 'dark', name: 'Grape Night Studio', scheme: 'dark', labelKey: 'me.themeDark', page: '#0B0716', surface: '#151024', raised: '#1E1833', spark: '#FF5C8A', volt: '#C6F432', text: '#F3EEFF' },
  { id: 'light', name: 'Sunrise Arcade', scheme: 'light', labelKey: 'me.themeLight', page: '#FFF6E9', surface: '#FFFFFF', raised: '#FFE8CC', spark: '#C42E0C', volt: '#2F7A20', text: '#3A2200' },
  { id: 'ocean', name: 'Polar Deep', scheme: 'dark', labelKey: 'me.themeOcean', page: '#2E3440', surface: '#3B4252', raised: '#434C5E', spark: '#88C0D0', volt: '#A3BE8C', text: '#ECEFF4' },
  { id: 'matcha', name: 'Matcha Forest', scheme: 'light', labelKey: 'me.themeMatcha', page: '#F5F7EE', surface: '#FFFFFF', raised: '#EAF0DE', spark: '#794824', volt: '#4F7000', text: '#203B2B' },
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

export const THEME_COLOR = { dark: '#0B0716', ocean: '#2E3440', light: '#FFF6E9', matcha: '#F5F7EE' };
