import { useState } from "react";
import { useTranslation } from "react-i18next";

import { PageHeader } from "./ui/PageHeader";
import { Segmented } from "./ui/Segmented";
import { applyTheme, getTheme, type Theme } from "./theme";

const LABELS = { kmk: "themeKmk", light: "themeLight", dark: "themeDark" } as const;

/** Per-person preferences. For now: the look of the app on this device. */
export default function SettingsPage() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<Theme>(getTheme);
  const choose = (next: Theme) => {
    applyTheme(next);
    setTheme(next);
  };
  return (
    <>
      <PageHeader title={t("settingsTitle")} />
      <section className="section">
        <h2>{t("settingsTheme")}</h2>
        <Segmented
          label={t("settingsTheme")}
          value={theme}
          onChange={choose}
          options={(Object.keys(LABELS) as Theme[]).map((value) => ({ value, label: t(LABELS[value]) }))}
        />
      </section>
    </>
  );
}
