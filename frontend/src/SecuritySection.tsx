import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import { mfaDisable, mfaRegenerate } from "./api";
import RecoveryCodes from "./RecoveryCodes";
import { PasswordInput } from "./ui/PasswordInput";

type Mode = null | "regenerate" | "disable";

export default function SecuritySection({
  csrfToken,
  mfaEnabled,
  onEnroll,
  onDisabled,
}: {
  csrfToken: string;
  mfaEnabled: boolean;
  onEnroll: () => void;
  onDisabled: () => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setMode(null);
    setPassword("");
    setCode("");
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = mode === "disable" ? await mfaDisable(csrfToken, password, code) : await mfaRegenerate(csrfToken, password, code);
    setBusy(false);
    if (!result.ok) {
      setError(
        { wrong_password: "wrongCurrentPassword", invalid_code: "invalidCode", mandatory: "mfaMandatory", rate_limited: "tooManyAttempts", unavailable: "mfaUnavailable", network: "networkError" }[result.reason],
      );
      return;
    }
    if (mode === "disable") {
      reset();
      onDisabled();
    } else {
      setCodes(result.recoveryCodes ?? []);
      reset();
    }
  }

  if (codes) return <RecoveryCodes codes={codes} onContinue={() => setCodes(null)} />;

  return (
    <section className="section">
      <h2>{t("securityTitle")}</h2>
      <p className="status">{t(mfaEnabled ? "mfaStatusOn" : "mfaStatusOff")}</p>
      {!mfaEnabled && <button type="button" onClick={onEnroll}>{t("mfaSetupTitle")}</button>}
      {mfaEnabled && mode === null && (
        <div className="row">
          <button type="button" className="secondary" onClick={() => setMode("regenerate")}>{t("regenerateCodes")}</button>
          <button type="button" className="secondary" onClick={() => setMode("disable")}>{t("disableMfa")}</button>
        </div>
      )}
      {mfaEnabled && mode !== null && (
        <form onSubmit={submit} className="form">
          <label>
            {t("password")}
            <PasswordInput label={t("password")} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required maxLength={1024} />
          </label>
          <label>
            {t("mfaCode")}
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" required maxLength={12} />
          </label>
          {error && <p className="error" role="alert">{t(error)}</p>}
          <div className="row">
            <button type="submit" disabled={busy}>{t("confirm")}</button>
            <button type="button" className="secondary" onClick={reset}>{t("dismiss")}</button>
          </div>
        </form>
      )}
    </section>
  );
}
