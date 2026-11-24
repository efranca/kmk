import { useTranslation } from "react-i18next";

import type { AdminUser } from "../api";
import { displayName } from "../person";
import { Avatar } from "../ui/Avatar";
import { memberColor } from "../ui/memberColor";

export const personOf = (user: AdminUser) => ({ id: user.id, name: displayName(user), color: memberColor(user.id), avatar_url: user.avatarUrl, active: user.status === "active" });

/** One person in the list: their face, name and email, their role, and a note when the account is not active. Tap to open. */
export default function UserRow({ user, onOpen }: { user: AdminUser; onOpen: () => void }) {
  const { t } = useTranslation();
  const privilegedWithoutMfa = user.role !== "user" && !user.mfaEnabled && user.status !== "deleted";
  return (
    <li>
      <article className={`user-card status-${user.status}`} aria-label={displayName(user)}>
        <button type="button" className="user-card__open" onClick={onOpen}>
          <Avatar person={personOf(user)} muted={user.status !== "active"} />
          <span className="user-card__who">
            <strong>{displayName(user)}</strong>
            <span className="muted">{user.name ? `${user.username} · ${user.email}` : user.email}</span>
          </span>
          <span className="user-card__chips">
            <span className="chip-tag">{t(`role_${user.role}`)}</span>
            {user.status !== "active" && <span className="chip-tag chip-tag--status">{t(`status_${user.status}`)}</span>}
            {privilegedWithoutMfa && <span className="chip-tag chip-tag--flag">{t("adminAdminNoMfa")}</span>}
          </span>
        </button>
      </article>
    </li>
  );
}
