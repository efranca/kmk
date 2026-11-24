// Whose tasks are shown (none picked = the whole team) lives in the URL (?people=1,4), so it survives reloads and the
// back button. It is only a filter: it never changes who is signed in.
import { useCallback } from "react";
import { useSearchParams } from "react-router";

export function useTaskPeople(): [number[], (ids: number[]) => void] {
  const [params, setParams] = useSearchParams();
  const ids = (params.get("people") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const set = useCallback(
    (next: number[]) =>
      setParams((p) => {
        const copy = new URLSearchParams(p);
        if (next.length > 0) copy.set("people", next.join(","));
        else copy.delete("people");
        return copy;
      }, { replace: true }),
    [setParams],
  );
  return [ids, set];
}
