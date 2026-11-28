import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import { changePassword } from "./api";
import { PasswordInput } from "./ui/PasswordInput";

export default function ChangePassword({ csrfToken }: { csrfToken: string }) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [message, setMessage] = useState<{ key: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = await changePassword(csrfToken, current, next);
    setBusy(false);
    if (result.ok) {
      setCurrent("");
      setNext("");
      setMessage({ key: "passwordChanged", ok: true });
    } else {
      const key = { wrong_password: "wrongCurrentPassword", weak: "weakPassword", same: "samePassword", rate_limited: "tooManyAttempts", network: "networkError" }[result.reason];
      setMessage({ key, ok: false });
    }
  }

  return (
    <section className="section settings-card">
      <h2>{t("changePasswordTitle")}</h2>
      <form onSubmit={submit} className="form">
        <p className="status">{t("passwordRules")}</p>
        <label>
          {t("currentPassword")}
          <PasswordInput label={t("currentPassword")} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required maxLength={1024} />
        </label>
        <label>
          {t("newPassword")}
          <PasswordInput label={t("newPassword")} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required maxLength={1024} />
        </label>
        {message && <p className={message.ok ? "status" : "error"} role={message.ok ? "status" : "alert"}>{t(message.key)}</p>}
        <button type="submit" disabled={busy}>{t("changePassword")}</button>
      </form>
    </section>
  );
}
