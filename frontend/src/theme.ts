export type Theme = "kmk" | "light" | "dark";
export const THEMES: Theme[] = ["kmk", "light", "dark"];

export const DEFAULT_THEME: Theme = "light";
const KEY = "kmk.theme";

/** The saved theme for this device; anything unknown (or unreadable storage) means the default look. */
export function getTheme(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    return THEMES.includes(value as Theme) ? (value as Theme) : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Switch the look now and remember it on this device (storage may be unavailable: the switch still applies). */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* applies for this visit only */
  }
}

export function initTheme(): void {
  document.documentElement.dataset.theme = getTheme();
}
