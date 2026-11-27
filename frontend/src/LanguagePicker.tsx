import { useTranslation } from "react-i18next";

import { LANGS, rememberLanguage } from "./lang";

/** Language choice for people who are not signed in: remembered in this browser only. */
export default function LanguagePicker() {
  const { t, i18n } = useTranslation();
  return (
    <div className="lang-picker" role="group" aria-label={t("language")}>
      {LANGS.filter((l) => l.code !== "pt-BR" && l.code !== "es").map((l) => ( // Portuguese and Spanish are not offered before signing in (people still get it in Settings)
        <button
          key={l.code}
          type="button"
          aria-pressed={i18n.language === l.code}
          onClick={() => {
            void i18n.changeLanguage(l.code);
            rememberLanguage(l.code);
          }}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
