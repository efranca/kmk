import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { request } from "./schedule/api";
import { applyTheme, type Theme } from "./theme";

/** What a person has chosen about how the app looks and behaves; it follows the account to every device. */
export type Preferences = {
  theme: Theme;
  sidebar_collapsed: boolean;
  tasks_view: "list" | "board";
  show_tasks_on_schedule: boolean;
  dashboard_widgets: { my_events: boolean; all_events: boolean; my_tasks: boolean };
};

export type PreferencesPatch = Partial<Omit<Preferences, "dashboard_widgets">> & { dashboard_widgets?: Partial<Preferences["dashboard_widgets"]> };

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "kmk",
  sidebar_collapsed: false,
  tasks_view: "list",
  show_tasks_on_schedule: false,
  dashboard_widgets: { my_events: true, all_events: true, my_tasks: true },
};

/** `base` with `patch` laid over it (the widgets merge one by one). */
export function mergePreferences(base: Preferences, patch: PreferencesPatch | undefined): Preferences {
  return { ...base, ...patch, dashboard_widgets: { ...base.dashboard_widgets, ...patch?.dashboard_widgets } } as Preferences;
}

type Value = { prefs: Preferences; update: (patch: PreferencesPatch) => void };
const Context = createContext<Value | null>(null);

/**
 * The signed-in person's preferences. A change shows at once and goes to the server; if the server refuses it, the
 * screen goes back to what it was. The theme is also kept in this browser so the next page load starts in it.
 */
export function PreferencesProvider({ initial, csrfToken, children }: { initial: Preferences; csrfToken: string; children: ReactNode }) {
  const [prefs, setPrefs] = useState(() => mergePreferences(DEFAULT_PREFERENCES, initial));
  const latest = useRef(prefs);
  latest.current = prefs;

  useEffect(() => {
    applyTheme(prefs.theme);
  }, [prefs.theme]);

  const update = useCallback(
    (patch: PreferencesPatch) => {
      const before = latest.current;
      const next = mergePreferences(before, patch);
      latest.current = next;
      setPrefs(next);
      request("PATCH", "/api/me/preferences", csrfToken, patch).catch(() => {
        // Put back only what this change touched, so a newer change made meanwhile is kept.
        const restore: Partial<Preferences> = {};
        for (const key of Object.keys(patch) as (keyof Preferences)[]) (restore as Record<string, unknown>)[key] = before[key];
        const back = { ...latest.current, ...restore };
        latest.current = back;
        setPrefs(back);
      });
    },
    [csrfToken],
  );

  return <Context.Provider value={{ prefs, update }}>{children}</Context.Provider>;
}

export function usePreferences(): Value {
  const value = useContext(Context);
  if (!value) throw new Error("usePreferences must be used inside <PreferencesProvider>");
  return value;
}
