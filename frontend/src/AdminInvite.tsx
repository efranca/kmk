import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import { adminInvite, type AdminResult } from "./api";

export default function AdminInvite({
  csrfToken,
  viewerRole,
  run,
}: {
  csrfToken: string;
  viewerRole: "user" | "admin" | "superadmin";
  run: (p: Promise<AdminResult>, okKey?: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [locale, setLocale] = useState("fr-CA");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    // Only the super admin may pick a role; the server enforces it too.
    const ok = await run(adminInvite(csrfToken, { username, email, locale, role: viewerRole === "superadmin" ? role : "user" }), "adminInviteSent");
    setBusy(false);
    if (ok) {
      setUsername("");
      setEmail("");
      setRole("user");
    }
  }

  return (
    <section className="section">
      <h2>{t("adminInviteTitle")}</h2>
      <form onSubmit={submit} className="form">
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
        <button type="submit" disabled={busy}>{t("adminInviteSend")}</button>
      </form>
    </section>
  );
}
