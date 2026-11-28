import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";

const KEY = "kmk.mfaBannerDismissed";

function wasDismissed(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Encourages turning on two-step verification. Permanent for admins, dismissible (per browser) for others. */
export default function MfaBanner({ role, onSetup }: { role: "user" | "admin" | "superadmin"; /** Where "Set up" goes (left out on the Account page, which already has the setup). */ onSetup?: () => void }) {
  const { t } = useTranslation();
  const privileged = role !== "user";
  const [hidden, setHidden] = useState(() => !privileged && wasDismissed());
  if (hidden) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      // Storage may be blocked: the banner is simply hidden until the next visit.
    }
    setHidden(true);
  }

  return (
    <aside className="mfacard" role="note">
      <span className="mfacard__icon" aria-hidden="true"><Icon name="shield" size={22} /></span>
      <div className="mfacard__text">
        <strong>{t("mfaBannerTitle")}</strong>
        <p>{t(privileged ? "mfaBannerAdmin" : "mfaBannerUser")}</p>
      </div>
      <div className="mfacard__actions">
        {onSetup && <Button variant="primary" onClick={onSetup}>{t("mfaBannerSetup")}</Button>}
        {!privileged && <Button variant="ghost" onClick={dismiss}>{t("dismiss")}</Button>}
      </div>
    </aside>
  );
}
