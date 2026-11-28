import { FormEvent, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { adminAct, adminEdit, adminRemoveAvatar, adminSetRole, adminSettings, type AdminResult, type AdminUser } from "../api";
import { displayName } from "../person";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { personOf } from "./UserRow";

// The actions, in the order and groups they are shown: the main one, then account changes, security resets, and the destructive ones apart.
const GROUPS: { id: string; actions: string[] }[] = [
  { id: "main", actions: ["edit"] },
  { id: "account", actions: ["set_role", "resend_invite", "enable", "restore"] },
  { id: "security", actions: ["reset_password", "reset_mfa"] },
  { id: "danger", actions: ["disable", "delete", "purge"] },
];

// Actions that need a "confirm" step before they are sent.
const CONFIRMED = new Set(["reset_password", "reset_mfa", "disable", "delete", "purge", "set_role"]);

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
  const [notifyQuotes, setNotifyQuotes] = useState(user.settings.notify_quotes);

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
        return adminAct(csrfToken, user.id, action as "disable" | "enable" | "delete" | "restore" | "purge");
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

  const canRemovePicture = user.avatarUrl !== null && user.actions.includes("edit");
  const actions = user.actions.filter((a) => a !== "view");
  const known = new Set(GROUPS.flatMap((g) => g.actions));
  const groups = GROUPS.map((g) => ({ id: g.id, actions: g.actions.filter((a) => actions.includes(a)) }))
    .map((g) => (g.id === "account" ? { ...g, actions: [...g.actions, ...actions.filter((a) => !known.has(a))] } : g)) // an action the server adds later lands with the account ones
    .filter((g) => g.actions.length > 0 || (g.id === "security" && canRemovePicture));
  // Only people who can read quote requests (administrators) have the switch, and only someone who may edit them can flip it.
  const canSetQuotes = user.actions.includes("edit") && user.role !== "user";
  async function toggleQuotes(on: boolean) {
    setNotifyQuotes(on);
    if (!(await run(adminSettings(csrfToken, user.id, { notify_quotes: on })))) setNotifyQuotes(!on);
  }

  return (
    <Dialog open title={displayName(user)} onClose={onClose}>
      {notice}
      <div className="user-dialog__head">
        <Avatar person={personOf(user)} size="xl" muted={user.status !== "active"} />
        <div className="user-dialog__who">
          {user.name && <span className="user-dialog__username">{user.username}</span>}
          <span className="user-dialog__email">{user.email}</span>
          <span className="user-card__chips">
            <span className="chip-tag">{t(`role_${user.role}`)}</span>
            <span className="chip-tag chip-tag--status">{t(`status_${user.status}`)}</span>
            <span className="chip-tag">{t(user.mfaEnabled ? "adminMfaOn" : "adminMfaOff")}</span>
          </span>
        </div>
      </div>
      <p className="user-dialog__seen" title={t("adminLastSignIn")}>
        <Icon name="clock" size={16} />
        <span>{t("adminLastSignIn")}: {user.lastSignIn ? new Date(user.lastSignIn).toLocaleString(i18n.language) : t("adminNever")}</span>
      </p>
      {canSetQuotes && !editing && !pending && (
        <label className="user-dialog__check">
          <input type="checkbox" checked={notifyQuotes} onChange={(e) => void toggleQuotes(e.target.checked)} />
          <span>{t("adminNotifyQuotes")}<small className="muted"> {t("adminNotifyQuotesHint")}</small></span>
        </label>
      )}
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
              <option value="es">Español</option>
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
          {pending === "purge" && <p>{t("adminPurgeWarning")}</p>}
          <Button variant="danger" onClick={confirm}>{t("confirm")}</Button>
          <Button variant="ghost" onClick={() => setPending(null)}>{t("adminCancel")}</Button>
        </div>
      ) : (
        <div className="user-actions">
          {groups.map((g) => (
            <div key={g.id} className={`user-actions__group user-actions__group--${g.id}`} data-group={g.id}>
              {g.actions.map((a) => (
                <Button key={a} variant={g.id === "main" ? "primary" : g.id === "danger" ? "danger" : "secondary"} onClick={() => void choose(a)}>{label(a)}</Button>
              ))}
              {g.id === "security" && canRemovePicture && <Button onClick={() => void run(adminRemoveAvatar(csrfToken, user.id)).then((ok) => ok && onClose())}>{t("avatarRemove")}</Button>}
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}
