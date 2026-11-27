import { useId } from "react";
import { useTranslation } from "react-i18next";

import LanguageSwitcher from "./LanguageSwitcher";
import { useSession } from "./session";
import type { User } from "./api";
import { usePreferences, type Preferences } from "./preferences";
import { PageHeader } from "./ui/PageHeader";
import { Toggle } from "./ui/Toggle";
import { NotificationsCard } from "./settings/NotificationsCard";
import { SystemSettingsCard } from "./settings/SystemSettingsCard";
import { ThemePicker } from "./settings/ThemePicker";
import type { Theme } from "./theme";

const THEME_LABELS = { kmk: "themeKmk", light: "themeLight", dark: "themeDark" } as const;
const WIDGETS = [
  { key: "my_events", label: "settingsWidgetMyEvents" },
  { key: "all_events", label: "settingsWidgetAllEvents" },
  { key: "my_tasks", label: "settingsWidgetMyTasks" },
  { key: "my_clients", label: "settingsWidgetMyClients", staffOnly: true },
  { key: "quotes_summary", label: "settingsWidgetQuotesSummary", adminOnly: true },
  { key: "quotes_latest", label: "settingsWidgetQuotesLatest", adminOnly: true },
] as const satisfies readonly { key: keyof Preferences["dashboard_widgets"]; label: string; adminOnly?: boolean; staffOnly?: boolean }[];

/** Per-person preferences. They belong to the account, so they follow the person to every device.
    The cards flow into as many columns as fit (up to three) and stay whole; the admin cards simply don't render for a regular user. */
export default function SettingsPage({ onLanguageChanged }: { onLanguageChanged: (user: User) => void }) {
  const { t } = useTranslation();
  const { csrfToken, user } = useSession();
  const { prefs, update } = usePreferences();
  const themeHint = useId();
  return (
    <>
      <PageHeader title={t("settingsTitle")} />
      <div className="settings-layout">
        <section className="section settings-card">
          <h2>{t("settingsLanguage")}</h2>
          <LanguageSwitcher csrfToken={csrfToken} onChanged={onLanguageChanged} />
        </section>
        <section className="section settings-card">
          <h2>{t("settingsTheme")}</h2>
          <p className="settings-hint" id={themeHint}>{t("settingsThemeHint")}</p>
          <ThemePicker
            label={t("settingsTheme")}
            describedBy={themeHint}
            value={prefs.theme}
            onChange={(theme: Theme) => update({ theme })}
            options={(Object.keys(THEME_LABELS) as Theme[]).map((value) => ({ value, label: t(THEME_LABELS[value]) }))}
          />
        </section>
        <section className="section settings-card">
          <h2>{t("settingsMenu")}</h2>
          <p className="settings-hint">{t("settingsMenuLabelsHint")}</p>
          <div className="settings-toggles">
            <Toggle label={t("settingsMenuLabels")} checked={prefs.show_menu_labels} onChange={(e) => update({ show_menu_labels: e.target.checked })} />
          </div>
        </section>
        <section className="section settings-card">
          <h2>{t("settingsDashboard")}</h2>
          <p className="settings-hint">{t("settingsDashboardHint")}</p>
          <div className="settings-toggles">
            {WIDGETS.filter((w) => (!("adminOnly" in w) || user.role !== "user") && (!("staffOnly" in w) || user.role === "user")).map(({ key, label }) => (
              <Toggle key={key} label={t(label)} checked={prefs.dashboard_widgets[key]} onChange={(e) => update({ dashboard_widgets: { [key]: e.target.checked } })} />
            ))}
          </div>
        </section>
        <NotificationsCard />
        <SystemSettingsCard />
      </div>
    </>
  );
}
