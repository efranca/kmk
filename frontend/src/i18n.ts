import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import frCA from "./locales/fr-CA.json";
import ptBR from "./locales/pt-BR.json";

// Default is French (CA); the language becomes per-user in a later phase, so no browser detection yet.
void i18next.use(initReactI18next).init({
  lng: "fr-CA",
  fallbackLng: "fr-CA",
  resources: {
    "fr-CA": { translation: frCA },
    en: { translation: en },
    "pt-BR": { translation: ptBR },
  },
  interpolation: { escapeValue: false },
});

export default i18next;
