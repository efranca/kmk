import { FormEvent, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { adminInvite, type AdminResult } from "../api";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

/** Invite someone: they get an email to choose their password. Only the super admin picks the role. */
export default function InviteDialog({
  csrfToken,
  viewerRole,
  run,
  notice,
  onClose,
}: {
  csrfToken: string;
  viewerRole: "user" | "admin" | "superadmin";
  run: (p: Promise<AdminResult>, okKey?: string) => Promise<boolean>;
  notice: ReactNode;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [locale, setLocale] = useState("fr-CA");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await run(adminInvite(csrfToken, { name, username, email, locale, role: viewerRole === "superadmin" ? role : "user" }), "adminInviteSent");
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Dialog
      open
      title={t("adminInviteTitle")}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("adminCancel")}</Button>
          <Button type="submit" form="invite-form" variant="primary" busy={busy}>{t("adminInviteSend")}</Button>
        </>
      }
    >
      {notice}
      <form id="invite-form" onSubmit={submit} className="form">
        <label>
          {t("adminName")}
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={100} />
        </label>
        <label>
          {t("adminUsername")}
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" required maxLength={32} />
        </label>
        <label>
          {t("adminEmail")}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} />
        </label>
        <label>
          {t("adminLanguage")}
          <select value={locale} onChange={(e) => setLocale(e.target.value)}>
            <option value="fr-CA">Français (CA)</option>
            <option value="en">English</option>
            <option value="pt-BR">Português (BR)</option>
          </select>
        </label>
        {viewerRole === "superadmin" && (
          <label>
            {t("adminRole")}
            <select value={role} onChange={(e) => setRole(e.target.value as "user" | "admin")}>
              <option value="user">{t("role_user")}</option>
              <option value="admin">{t("role_admin")}</option>
            </select>
          </label>
        )}
      </form>
    </Dialog>
  );
}
