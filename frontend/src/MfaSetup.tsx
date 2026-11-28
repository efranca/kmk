import { toDataURL } from "qrcode";
import { FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { mfaEnable, mfaSetup } from "./api";
import RecoveryCodes from "./RecoveryCodes";

type Pending = { secret: string; qr: string };

export default function MfaSetup({
  csrfToken,
  onDone,
  onCancel,
  onSignOut,
}: {
  csrfToken: string;
  onDone: () => void;
  onCancel?: () => void;
  onSignOut?: () => void;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<Pending | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true; // a stale response (React dev double-mount) must not replace the current secret
    void (async () => {
      const result = await mfaSetup(csrfToken);
      if (!alive) return;
      if (!result.ok) {
        setError(result.reason === "unavailable" ? "mfaUnavailable" : "networkError");
        return;
      }
      const qr = await toDataURL(result.otpauthUri, { margin: 1, width: 200 });
      if (alive) setPending({ secret: result.secret, qr });
    })();
    return () => {
      alive = false;
    };
  }, [csrfToken]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await mfaEnable(csrfToken, code);
    setBusy(false);
    if (result.ok) {
      setCodes(result.recoveryCodes);
    } else {
      setError(
        result.reason === "invalid_code" ? "invalidCode" : result.reason === "rate_limited" ? "tooManyAttempts" : result.reason === "unavailable" ? "mfaUnavailable" : "networkError",
      );
    }
  }

  if (codes) return <RecoveryCodes codes={codes} onContinue={onDone} />;

  return (
    <div className="mfasetup">
      <h1>{t("mfaSetupTitle")}</h1>
      <p className="mfasetup__intro">{t("mfaSetupIntro")}</p>
      {pending && (
        <div className="mfasetup__grid">
          <div className="mfasetup__qr">
            <img className="qr" src={pending.qr} alt={t("mfaQrAlt")} width="200" height="200" />
          </div>
          <div className="mfasetup__side">
            <div className="mfasetup__key">
              <span>{t("mfaSecretLabel")}</span>
              <code className="secret">{pending.secret}</code>
            </div>
            <form onSubmit={submit} className="mfasetup__form">
              <label>
                {t("mfaCode")}
                <input className="mfasetup__code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" required maxLength={12} />
              </label>
              {error && <p className="error" role="alert">{t(error)}</p>}
              <button type="submit" disabled={busy}>{t("mfaEnable")}</button>
            </form>
          </div>
        </div>
      )}
      {!pending && error && <p className="error" role="alert">{t(error)}</p>}
      <div className="mfasetup__foot">
        {onCancel && <button type="button" className="secondary" onClick={onCancel}>{t("mfaBackToAccount")}</button>}
        {onSignOut && <button type="button" className="secondary" onClick={onSignOut}>{t("signOut")}</button>}
      </div>
    </div>
  );
}
