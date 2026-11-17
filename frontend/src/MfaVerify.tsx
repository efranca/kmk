import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import { mfaVerify } from "./api";

export default function MfaVerify({
  csrfToken,
  onVerified,
  onSignOut,
}: {
  csrfToken: string;
  onVerified: (remaining: number, usedRecoveryCode: boolean) => void;
  onSignOut: () => void;
}) {
  const { t } = useTranslation();
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await mfaVerify(csrfToken, useRecovery ? { recoveryCode: value } : { code: value });
    setBusy(false);
    if (result.ok) {
      onVerified(result.remaining, useRecovery);
    } else {
      setError(
        result.reason === "invalid_code" ? "invalidCode" : result.reason === "rate_limited" ? "tooManyAttempts" : result.reason === "unavailable" ? "mfaUnavailable" : "networkError",
      );
    }
  }

  return (
    <>
      <h1>{t("mfaCodeTitle")}</h1>
      <form onSubmit={submit} className="form">
        <label>
          {t(useRecovery ? "recoveryCode" : "mfaCode")}
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode={useRecovery ? "text" : "numeric"}
            autoComplete="one-time-code"
            autoCapitalize="none"
            required
            maxLength={32}
          />
        </label>
        {error && <p className="error" role="alert">{t(error)}</p>}
        <button type="submit" disabled={busy}>{t("mfaVerify")}</button>
      </form>
      <p>
        <button
          type="button"
          className="linklike"
          onClick={() => {
            setUseRecovery(!useRecovery);
            setValue("");
            setError(null);
          }}
        >
          {t(useRecovery ? "useAuthenticatorCode" : "useRecoveryCode")}
        </button>
      </p>
      <button type="button" className="secondary" onClick={onSignOut}>{t("signOut")}</button>
    </>
  );
}
