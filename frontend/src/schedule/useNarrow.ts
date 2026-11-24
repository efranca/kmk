import { useEffect, useState } from "react";

const QUERY = "(max-width: 640px)";

/** True on phone-width screens (the Week view then shows three days instead of seven). */
export function useNarrow(): boolean {
  const supported = typeof window !== "undefined" && typeof window.matchMedia === "function";
  const [narrow, setNarrow] = useState(() => supported && window.matchMedia(QUERY).matches);
  useEffect(() => {
    if (!supported) return;
    const list = window.matchMedia(QUERY);
    const onChange = () => setNarrow(list.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [supported]);
  return narrow;
}
