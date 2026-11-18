import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import { adminAct, adminEdit, adminSetRole, type AdminResult, type AdminUser } from "./api";
import { displayName } from "./person";

// Actions that need an inline "confirm" step before they are sent.
const CONFIRMED = new Set(["reset_password", "reset_mfa", "disable", "delete", "set_role"]);

export default function AdminUserRow({
  user,
  csrfToken,
  run,
}: {
  user: AdminUser;
  csrfToken: string;
  run: (p: Promise<AdminResult>, okKey?: string) => Promise<boolean>;
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

  async function choose(action: string) {
    if (action === "edit") {
      setEditing(true);
    } else if (CONFIRMED.has(action)) {
      setPending(action);
    } else {
      await run(send(action));
    }
  }

  async function confirm() {
    const action = pending;
    setPending(null);
    if (action) await run(send(action));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const changes: { locale?: string; email?: string; name?: string } = {};
    if (locale !== user.locale) changes.locale = locale;
    if (name.trim() && name.trim() !== (user.name ?? "")) changes.name = name.trim();
    if (user.status === "invited" && email !== user.email) changes.email = email;
    const ok = Object.keys(changes).length ? await run(adminEdit(csrfToken, user.id, changes)) : true;
    if (ok) setEditing(false);
  }

  const actions = user.actions.filter((a) => a !== "view");
  const privilegedWithoutMfa = user.role !== "user" && !user.mfaEnabled && user.status !== "deleted";

  return (
    <article className={`user-row status-${user.status}`} aria-label={displayName(user)}>
      <div className="who">
        <strong>{displayName(user)}</strong>
        <span className="muted">{user.name ? `${user.username} · ${user.email}` : user.email}</span>
      </div>
      <div className="badges">
        <span className="badge">{t(`role_${user.role}`)}</span>
        <span className="badge">{t(`status_${user.status}`)}</span>
        <span className="badge">{t(user.mfaEnabled ? "adminMfaOn" : "adminMfaOff")}</span>
        {privilegedWithoutMfa && <span className="badge flag">{t("adminAdminNoMfa")}</span>}
      </div>
      <div className="muted" title={t("adminLastSignIn")}>
        {user.lastSignIn ? new Date(user.lastSignIn).toLocaleString(i18n.language) : t("adminNever")}
      </div>
      <div className="row-actions">
        {editing ? (
          <form onSubmit={save} className="form inline">
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
              <button type="submit">{t("adminSave")}</button>
              <button type="button" className="secondary" onClick={() => setEditing(false)}>{t("adminCancel")}</button>
            </div>
          </form>
        ) : pending ? (
          <div className="row">
            <button type="button" onClick={confirm}>{t("confirm")}</button>
            <button type="button" className="secondary" onClick={() => setPending(null)}>{t("adminCancel")}</button>
          </div>
        ) : (
          <div className="row">
            {actions.map((a) => (
              <button key={a} type="button" className="secondary" onClick={() => choose(a)}>{label(a)}</button>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
