export type Lang = "fr-CA" | "en" | "pt-BR";

export const LANGS: { code: Lang; label: string }[] = [
  { code: "fr-CA", label: "FR" },
  { code: "en", label: "EN" },
  { code: "pt-BR", label: "PT" },
];

const KEY = "kmk.lang";

export function isLang(x: unknown): x is Lang {
  return x === "fr-CA" || x === "en" || x === "pt-BR";
}

/** The language chosen on this browser before signing in (storage may be blocked: then there is none). */
export function savedLanguage(): Lang | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return isLang(v) ? v : null;
  } catch {
    return null;
  }
}

export function rememberLanguage(code: Lang): void {
  try {
    window.localStorage.setItem(KEY, code);
  } catch {
    // Without storage the choice simply lasts for this visit.
  }
}

export function initialLanguage(): Lang {
  return savedLanguage() ?? "fr-CA";
}
