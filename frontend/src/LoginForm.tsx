import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import { login, type Session } from "./api";

export default function LoginForm({ onSignedIn, onForgot }: { onSignedIn: (s: Session) => void; onForgot: () => void }) {
  const { t } = useTranslation();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await login(identifier, password);
    setBusy(false);
    if (result.ok) {
      setPassword("");
      onSignedIn({ user: result.user, csrfToken: result.csrfToken, mfa: result.mfa, mfaEnabled: result.mfaEnabled, preferences: result.preferences });
    } else {
      setError(result.reason === "rate_limited" ? "tooManyAttempts" : result.reason === "network" ? "networkError" : "invalidCredentials");
    }
  }

  return (
    <>
      <h1>{t("signInTitle")}</h1>
      <form onSubmit={submit} className="form">
        <label>
          {t("identifier")}
          <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" autoCapitalize="none" required maxLength={256} />
        </label>
        <label>
          {t("password")}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required maxLength={1024} />
        </label>
        {error && <p className="error" role="alert">{t(error)}</p>}
        <button type="submit" disabled={busy}>{t("signIn")}</button>
      </form>
      <p>
        <a href="/forgot-password" onClick={(e) => { e.preventDefault(); onForgot(); }}>{t("forgotPasswordLink")}</a>
      </p>
    </>
  );
}
