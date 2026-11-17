import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import { forgotPassword } from "./api";

export default function ForgotPassword({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const [identifier, setIdentifier] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const result = await forgotPassword(identifier);
    setBusy(false);
    setMessage(result === "ok" ? "forgotDone" : result === "rate_limited" ? "tooManyAttempts" : "networkError");
  }

  return (
    <>
      <h1>{t("forgotTitle")}</h1>
      <p className="status">{t("forgotIntro")}</p>
      <form onSubmit={submit} className="form">
        <label>
          {t("identifier")}
          <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" autoCapitalize="none" required maxLength={256} />
        </label>
        {message && <p className={message === "forgotDone" ? "status" : "error"} role="status">{t(message)}</p>}
        <button type="submit" disabled={busy}>{t("send")}</button>
      </form>
      <p><a href="/" onClick={(e) => { e.preventDefault(); onBack(); }}>{t("backToSignIn")}</a></p>
    </>
  );
}
