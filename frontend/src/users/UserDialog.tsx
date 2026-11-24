import { FormEvent, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { adminAct, adminEdit, adminRemoveAvatar, adminSetRole, type AdminResult, type AdminUser } from "../api";
import { displayName } from "../person";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { personOf } from "./UserRow";

// Actions that need a "confirm" step before they are sent.
const CONFIRMED = new Set(["reset_password", "reset_mfa", "disable", "delete", "set_role"]);

/** One person's details and what the signed-in admin may do with them (the server's `actions` list decides). */
export default function UserDialog({
  user,
  csrfToken,
  run,
  notice,
  onClose,
}: {
  user: AdminUser;
  csrfToken: string;
  run: (p: Promise<AdminResult>, okKey?: string) => Promise<boolean>;
  notice: ReactNode;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [pending, setPending] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [locale, setLocale] = useState<string>(user.locale);
  const [email, setEmail] = useState(user.email);
  const [name, setName] = useState(user.name ?? "");

  const label = (action: string) => (action === "set_role" ? (user.role === "admin" ? t("act_make_user") : t("act_make_admin")) : t(`act_${action}`));

  function send(action: string): Promise<AdminResult> {
    switch (action) {
      case "resend_invite":
        return adminAct(csrfToken, user.id, "invite");
      case "reset_password":
        return adminAct(csrfToken, user.id, "reset");
      case "reset_mfa":
        return adminAct(csrfToken, user.id, "reset-mfa");
      case "set_role":
        return adminSetRole(csrfToken, user.id, user.role === "admin" ? "user" : "admin");
      default:
        return adminAct(csrfToken, user.id, action as "disable" | "enable" | "delete" | "restore");
    }
  }

  async function go(action: string) {
    if (await run(send(action))) onClose();
  }

  async function choose(action: string) {
    if (action === "edit") setEditing(true);
    else if (CONFIRMED.has(action)) setPending(action);
    else await go(action);
  }

  async function confirm() {
    const action = pending;
    setPending(null);
    if (action) await go(action);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const changes: { locale?: string; email?: string; name?: string } = {};
    if (locale !== user.locale) changes.locale = locale;
    if (name.trim() && name.trim() !== (user.name ?? "")) changes.name = name.trim();
    if (user.status === "invited" && email !== user.email) changes.email = email;
    const ok = Object.keys(changes).length ? await run(adminEdit(csrfToken, user.id, changes)) : true;
    if (ok) onClose();
  }

  const actions = user.actions.filter((a) => a !== "view");
  const canRemovePicture = user.avatarUrl !== null && user.actions.includes("edit");

  return (
    <Dialog open title={displayName(user)} onClose={onClose}>
      {notice}
      <div className="user-dialog__head">
        <Avatar person={personOf(user)} size="lg" muted={user.status !== "active"} />
        <div className="user-card__who">
          <span className="muted">{user.name ? `${user.username} · ${user.email}` : user.email}</span>
          <span className="user-card__chips">
            <span className="chip-tag">{t(`role_${user.role}`)}</span>
            <span className="chip-tag chip-tag--status">{t(`status_${user.status}`)}</span>
            <span className="chip-tag">{t(user.mfaEnabled ? "adminMfaOn" : "adminMfaOff")}</span>
          </span>
          <span className="muted" title={t("adminLastSignIn")}>
            {t("adminLastSignIn")}: {user.lastSignIn ? new Date(user.lastSignIn).toLocaleString(i18n.language) : t("adminNever")}
          </span>
        </div>
      </div>
      {editing ? (
        <form onSubmit={save} className="form">
          <label>
            {t("adminName")}
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" maxLength={100} />
          </label>
          <label>
            {t("adminLanguage")}
            <select value={locale} onChange={(e) => setLocale(e.target.value)}>
              <option value="fr-CA">Français (CA)</option>
              <option value="en">English</option>
              <option value="pt-BR">Português (BR)</option>
            </select>
          </label>
          {user.status === "invited" && (
            <label>
              {t("adminEmail")}
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} />
            </label>
          )}
          <div className="row">
            <Button type="submit" variant="primary">{t("adminSave")}</Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>{t("adminCancel")}</Button>
          </div>
        </form>
      ) : pending ? (
        <div className="row">
          <Button variant="danger" onClick={confirm}>{t("confirm")}</Button>
          <Button variant="ghost" onClick={() => setPending(null)}>{t("adminCancel")}</Button>
        </div>
      ) : (
        <div className="row user-dialog__actions">
          {actions.map((a) => (
            <Button key={a} onClick={() => void choose(a)}>{label(a)}</Button>
          ))}
          {canRemovePicture && <Button onClick={() => void run(adminRemoveAvatar(csrfToken, user.id)).then((ok) => ok && onClose())}>{t("avatarRemove")}</Button>}
        </div>
      )}
    </Dialog>
  );
}
