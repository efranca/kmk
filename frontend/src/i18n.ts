import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import frCA from "./locales/fr-CA.json";
import { initialLanguage } from "./lang";
import ptBR from "./locales/pt-BR.json";

// Start in the language saved on this browser (set before signing in), otherwise French (CA). After sign-in the user's own language wins.
void i18next.use(initReactI18next).init({
  lng: initialLanguage(),
  fallbackLng: "fr-CA",
  resources: {
    "fr-CA": { translation: frCA },
    en: { translation: en },
    "pt-BR": { translation: ptBR },
  },
  interpolation: { escapeValue: false },
});

export default i18next;
