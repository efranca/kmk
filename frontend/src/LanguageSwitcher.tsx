import { ChangeEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import { setLocale, type User } from "./api";
import { isLang, rememberLanguage } from "./lang";

/** Language choice for signed-in users: stored on the server (so it follows them and sets their email language). */
export default function LanguageSwitcher({ csrfToken, onChanged }: { csrfToken: string; onChanged: (user: User) => void }) {
  const { t, i18n } = useTranslation();
  const [failed, setFailed] = useState(false);

  async function change(e: ChangeEvent<HTMLSelectElement>) {
    const code = e.target.value;
    setFailed(false);
    if (!isLang(code)) return;
    const result = await setLocale(csrfToken, code);
    if (!result.ok) {
      setFailed(true); // the select is controlled by the current language, so it snaps back
      return;
    }
    await i18n.changeLanguage(code);
    rememberLanguage(code);
    onChanged(result.user);
  }

  return (
    <span className="lang-switcher">
      <select aria-label={t("language")} value={i18n.language} onChange={change}>
        <option value="fr-CA">Français (CA)</option>
        <option value="en">English</option>
        <option value="pt-BR">Português (BR)</option>
      </select>
      {failed && <span className="error" role="alert">{t("langError")}</span>}
    </span>
  );
}
