import { useState } from "react";
import { useTranslation } from "react-i18next";

export default function RecoveryCodes({ codes, onContinue }: { codes: string[]; onContinue: () => void }) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState(false);

  function copy() {
    void navigator.clipboard?.writeText(codes.join("\n"));
  }

  function download() {
    const url = URL.createObjectURL(new Blob([codes.join("\n") + "\n"], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "kmk-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="section">
      <h2>{t("recoveryCodesTitle")}</h2>
      <p className="status">{t("recoveryCodesIntro")}</p>
      <ul className="codes">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="row">
        <button type="button" className="secondary" onClick={copy}>{t("copyCodes")}</button>
        <button type="button" className="secondary" onClick={download}>{t("downloadCodes")}</button>
      </div>
      <label className="check">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        {t("savedCodes")}
      </label>
      <button type="button" disabled={!saved} onClick={onContinue}>{t("continue")}</button>
    </section>
  );
}
