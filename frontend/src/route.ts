import { useCallback, useEffect, useState } from "react";

let remembered: string | null = null;

/** Reads `#token=...` once, removes it from the address bar, and remembers it (survives React's dev double-render). */
export function consumeToken(): string | null {
  const match = /(?:^#|&)token=([^&]+)/.exec(window.location.hash);
  if (match) {
    remembered = decodeURIComponent(match[1]);
    window.history.replaceState(null, "", window.location.pathname);
  }
  return remembered;
}

export function forgetToken(): void {
  remembered = null;
}

export function useRoute(): { path: string; navigate: (to: string) => void } {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = useCallback((to: string) => {
    forgetToken();
    window.history.pushState(null, "", to);
    setPath(window.location.pathname);
  }, []);
  return { path, navigate };
}
