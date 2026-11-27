import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router";

import { isLang, type Lang } from "./lang";

let remembered: string | null = null;
let rememberedLang: Lang | null = null;

/**
 * Reads `#token=...&lang=...` once, removes it from the address bar, and remembers both
 * (survives React's dev double-render). The language is optional and ignored unless it is one of ours.
 */
export function consumeToken(): string | null {
  const hash = window.location.hash;
  const match = /(?:^#|&)token=([^&]+)/.exec(hash);
  if (match) {
    remembered = decodeURIComponent(match[1]);
    const lang = /(?:^#|&)lang=([^&]+)/.exec(hash);
    const value = lang ? decodeURIComponent(lang[1]) : null;
    rememberedLang = isLang(value) ? value : null;
    window.history.replaceState(null, "", window.location.pathname);
  }
  return remembered;
}

/** The language carried by the emailed link that was last consumed, if valid. */
export function linkLanguage(): Lang | null {
  return rememberedLang;
}

export function forgetToken(): void {
  remembered = null;
  rememberedLang = null;
}

export function useRoute(): { path: string; search: string; navigate: (to: string, replace?: boolean) => void } {
  const location = useLocation();
  const go = useNavigate();
  const navigate = useCallback(
    (to: string, replace = false) => {
      forgetToken();
      go(to, { replace });
    },
    [go],
  );
  return { path: location.pathname, search: location.search, navigate };
}
