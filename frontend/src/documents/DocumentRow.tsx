import { useTranslation } from "react-i18next";

import { FALLBACK_CATEGORY_ICON } from "../tasks/CategoryChips";
import type { DocumentCategory, DocumentItem } from "./api";
import { fileKind } from "./fileKind";
import { formatSize } from "./prepareDocument";

const LEVEL_KEYS = { everyone: "docLevelEveryone", admins: "docLevelAdmins", superadmin: "docLevelSuperadmin" } as const;

/** One document as a row: its icon, the title, category, size and date, and who can see it. Opens the viewer. */
export function DocumentRow({ document: d, category, onOpen }: { document: DocumentItem; category?: DocumentCategory; onOpen: () => void }) {
  const { t, i18n } = useTranslation();
  return (
    <li>
      <button type="button" className="doc" onClick={onOpen}>
        <span className="doc__icon" aria-hidden="true">{fileKind(d.content_type, d.file_name).icon}</span>
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
}
