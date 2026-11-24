import { usePreferences } from "../preferences";

/** Whether the desktop sidebar is collapsed to icons: part of the person's preferences, so it follows the account. */
export function useSidebarCollapsed(): [boolean, () => void] {
  const { prefs, update } = usePreferences();
  return [prefs.sidebar_collapsed, () => update({ sidebar_collapsed: !prefs.sidebar_collapsed })];
}
