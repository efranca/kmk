import { useState } from "react";
import { useTranslation } from "react-i18next";

const KEY = "kmk.mfaBannerDismissed";

function wasDismissed(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Encourages turning on two-step verification. Permanent for admins, dismissible (per browser) for others. */
export default function MfaBanner({ role }: { role: "user" | "admin" | "superadmin" }) {
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
    <aside className="banner" role="note">
      <p>{t(privileged ? "mfaBannerAdmin" : "mfaBannerUser")}</p>
      {!privileged && <button type="button" className="secondary" onClick={dismiss}>{t("dismiss")}</button>}
    </aside>
  );
}
