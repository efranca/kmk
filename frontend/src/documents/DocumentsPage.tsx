import { useState } from "react";
import { useTranslation } from "react-i18next";

import { usePreferences } from "../preferences";
import { useSession } from "../session";
import { Button, IconButton } from "../ui/Button";
import { EmptyArt } from "../ui/EmptyArt";
import { EmptyState, ErrorNotice, Loading } from "../ui/Feedback";
import { PageHeader } from "../ui/PageHeader";
import { CategoryChips, FALLBACK_CATEGORY_ICON } from "../tasks/CategoryChips";
import { matchesSearch } from "../tasks/search";
import type { DocumentItem } from "./api";
import { ViewMenuButton } from "../tasks/ViewMenuButton";
import { DocCategoryManager } from "./DocCategoryManager";
import { DocumentDialog } from "./DocumentDialog";
import { DocumentTile } from "./DocumentTile";
import { useDocuments } from "./hooks";
import { useDocumentsView, type DocumentsView } from "./useDocumentsView";
import { formatSize } from "./prepareDocument";

const LEVEL_KEYS = { everyone: "docLevelEveryone", admins: "docLevelAdmins", superadmin: "docLevelSuperadmin" } as const;

/** The company library: documents by category, found by title, note, category or file name. Administrators add and change them. */
export function DocumentsPage() {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const canManage = user.role !== "user";
  const { prefs, update } = usePreferences();
  const [view, setView] = useDocumentsView();
  const showChips = prefs.show_document_categories; // off until the person turns them on; it follows their account
  const { data, isPending, isError, error, refetch } = useDocuments();
  const [searchOpen, setSearchOpen] = useState(false);
  const [text, setText] = useState("");
  const [managing, setManaging] = useState(false);
  const [pick, setPick] = useState<number | null>(null);
  const [editing, setEditing] = useState<DocumentItem | "new" | null>(null);

  const documents = data?.documents ?? [];
  const categories = data?.categories ?? [];
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const searching = text.trim().length > 0;
  const matching = searching
    ? documents.filter((d) => matchesSearch(text, d.title, d.note, d.file_name, d.category_id ? categoryById.get(d.category_id)?.name : ""))
    : documents;
  // Hidden chips cannot filter: with them off, every document shows.
  const selected = showChips && pick !== null && categoryById.has(pick) ? pick : null;
  const countOf = new Map<number, number>();
  for (const d of matching) if (d.category_id !== null) countOf.set(d.category_id, (countOf.get(d.category_id) ?? 0) + 1);
  const visible = selected !== null ? matching.filter((d) => d.category_id === selected) : matching;

  return (
    <div className="page page--documents">
      <PageHeader
        title={t("docTitle")}
        actions={
          <>
            <IconButton icon="search" label={t("docSearchLabel")} aria-pressed={searchOpen} onClick={() => { setManaging(false); if (searchOpen) setText(""); setSearchOpen(!searchOpen); }} />
            <IconButton icon="tag" label={t("docShowCategories")} aria-pressed={showChips} onClick={() => update({ show_document_categories: !showChips })} />
            <ViewMenuButton<DocumentsView> view={view} onView={setView} managing={managing} menuLabel={t("docViewMenu")} heading={t("docView")}
              views={[{ id: "list", label: t("docViewList") }, { id: "tiles", label: t("docViewTiles") }]}
              onManage={() => { setSearchOpen(false); setText(""); setManaging(!managing); }} />
            {canManage && <IconButton icon="plus" variant="primary" label={t("docNew")} onClick={() => setEditing("new")} />}
          </>
        }
      />
      {managing ? <DocCategoryManager onClose={() => setManaging(false)} /> : (
        <>
          {searchOpen && (
            <label className="tasks-toolbar__search">
              <span className="visually-hidden">{t("docSearchLabel")}</span>
              <input type="search" value={text} autoFocus placeholder={t("docSearchPlaceholder")} onChange={(e) => setText(e.target.value)} />
            </label>
          )}
          {showChips && categories.length > 0 && (
            <CategoryChips label={t("docCatFilter")} allLabel={t("taskCatAll")} allCount={matching.length}
              options={categories.map((c) => ({ id: c.id, name: c.name, icon: c.icon, count: countOf.get(c.id) ?? 0 }))}
              selected={selected} onSelect={setPick} />
          )}
          {isPending ? <Loading />
            : isError ? <ErrorNotice error={error} onRetry={() => void refetch()} />
            : documents.length === 0 ? (
              <EmptyArt art="documents" title={t("docEmpty")} hint={t("docEmptyFun")}>
                {canManage && <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>{t("docAddFirst")}</Button>}
              </EmptyArt>
            )
            : visible.length === 0 ? <EmptyState>{searching ? t("docSearchNoResults", { q: text.trim() }) : t("docEmptyCategory")}</EmptyState>
            : view === "tiles" ? (
              <ul className="doc-tiles">
                {visible.map((d) => <DocumentTile key={d.id} document={d} category={d.category_id ? categoryById.get(d.category_id) : undefined} onOpen={() => setEditing(d)} />)}
              </ul>
            )
            : (
              <ul className="docs">
                {visible.map((d) => {
                  const category = d.category_id ? categoryById.get(d.category_id) : undefined;
                  return (
                    <li key={d.id}>
                      <button type="button" className="doc" onClick={() => setEditing(d)}>
                        <span className="doc__icon" aria-hidden="true">{d.content_type === "application/pdf" ? "📄" : "🖼️"}</span>
                        <span className="doc__main">
                          <strong>{d.title}</strong>
                          <span className="muted">
                            {category ? `${category.icon ?? FALLBACK_CATEGORY_ICON} ${category.name} · ` : ""}
                            {formatSize(d.size_bytes ?? 0)} · {new Date(d.created_at).toLocaleDateString(i18n.language, { dateStyle: "medium" })}
                          </span>
                        </span>
                        <span className="chip-tag">{t(LEVEL_KEYS[d.visibility])}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
        </>
      )}
      {editing && <DocumentDialog key={editing === "new" ? "new" : editing.id} document={editing === "new" ? null : editing} categories={categories} onClose={() => setEditing(null)} />}
    </div>
  );
}
