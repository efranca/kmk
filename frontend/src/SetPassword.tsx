import { FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { setPassword } from "./api";
import { consumeToken, forgetToken, linkLanguage } from "./route";

export default function SetPassword({ onBack }: { onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const [token] = useState(() => consumeToken());
  useEffect(() => {
    // The emailed link carries the recipient's language: use it for this visit (it is not saved as a preference).
    const lang = linkLanguage();
    if (lang) void i18n.changeLanguage(lang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [password, setPasswordValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(token ? null : "invalidLink");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (password !== confirm) {
      setError("passwordsDontMatch");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await setPassword(token, password);
    setBusy(false);
    if (result.ok) {
      forgetToken();
      setDone(true);
    } else {
      setError(
        result.reason === "invalid_token" ? "invalidLink" : result.reason === "weak" ? "weakPassword" : result.reason === "rate_limited" ? "tooManyAttempts" : "networkError",
      );
    }
  }

  const back = (
    <p>
      <a href="/" onClick={(e) => { e.preventDefault(); onBack(); }}>{t("backToSignIn")}</a>
    </p>
  );

  if (done) {
    return (
      <>
        <h1>{t("setPasswordTitle")}</h1>
        <p className="status" role="status">{t("setPasswordDone")}</p>
        {back}
      </>
    );
  }

  return (
    <>
      <h1>{t("setPasswordTitle")}</h1>
      {token && (
        <form onSubmit={submit} className="form">
          <p className="status">{t("passwordRules")}</p>
          <label>
            {t("newPassword")}
            <input type="password" value={password} onChange={(e) => setPasswordValue(e.target.value)} autoComplete="new-password" required maxLength={1024} />
          </label>
          <label>
            {t("confirmPassword")}
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required maxLength={1024} />
          </label>
          {error && <p className="error" role="alert">{t(error)}</p>}
          <button type="submit" disabled={busy}>{t("savePassword")}</button>
        </form>
      )}
      {!token && error && <p className="error" role="alert">{t(error)}</p>}
      {back}
    </>
  );
}
