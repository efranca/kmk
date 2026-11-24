import { usePreferences } from "../preferences";

export type DocumentsView = "list" | "tiles";

/** How the documents are shown: a list or tiles with previews. A per-account preference. */
export function useDocumentsView(): [DocumentsView, (view: DocumentsView) => void] {
  const { prefs, update } = usePreferences();
  return [prefs.documents_view, (view) => update({ documents_view: view })];
}
