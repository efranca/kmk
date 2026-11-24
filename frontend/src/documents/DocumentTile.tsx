import { useTranslation } from "react-i18next";

import { FALLBACK_CATEGORY_ICON } from "../tasks/CategoryChips";
import { previewUrl, type DocumentCategory, type DocumentItem } from "./api";
import { fileKind } from "./fileKind";
import { formatSize } from "./prepareDocument";

const LEVEL_KEYS = { everyone: "docLevelEveryone", admins: "docLevelAdmins", superadmin: "docLevelSuperadmin" } as const;

/** One document as a tile: its preview (or an icon for its kind), the title, and a line of facts. */
export function DocumentTile({ document: d, category, onOpen }: { document: DocumentItem; category?: DocumentCategory; onOpen: () => void }) {
  const { t, i18n } = useTranslation();
  const kind = fileKind(d.content_type, d.file_name);
  return (
    <li>
      <button type="button" className="doc-tile" onClick={onOpen}>
        <span className="doc-tile__preview">
          {d.has_preview
            ? <img src={previewUrl(d.id, d.updated_at)} alt="" loading="lazy" />
            : <span className="doc-tile__icon" aria-hidden="true">{kind.icon}</span>}
        </span>
        <span className="doc-tile__body">
          <strong className="doc-tile__title">{d.title}</strong>
          <span className="muted doc-tile__meta">
            {category ? `${category.icon ?? FALLBACK_CATEGORY_ICON} ` : ""}{formatSize(d.size_bytes ?? 0)} · {new Date(d.created_at).toLocaleDateString(i18n.language, { dateStyle: "medium" })}
          </span>
          <span className="chip-tag">{t(LEVEL_KEYS[d.visibility])}</span>
        </span>
      </button>
    </li>
  );
}
