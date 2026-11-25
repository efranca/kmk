import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { currentSubscription, disablePush, enablePush, pushSupported, testPush } from "../push";
import { useSession } from "../session";
import { Button } from "../ui/Button";
import { ErrorNotice } from "../ui/Feedback";
import { useToast } from "../ui/toastContext";

type State = "checking" | "unsupported" | "off" | "on" | "denied" | "no_key";

/** iPhone only delivers web push to an app added to the Home Screen. */
function needsHomeScreen(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return /iPhone|iPad|iPod/.test(nav.userAgent) && nav.standalone === false;
}

/** Turns push notifications on or off for this device (admins and the super admin). */
export function NotificationsCard() {
  const { t } = useTranslation();
  const toast = useToast();
  const { user, csrfToken } = useSession();
  const allowed = user.role !== "user";
  const [state, setState] = useState<State>("checking");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  useEffect(() => {
    if (!allowed) return;
    if (!pushSupported()) { setState("unsupported"); return; }
    let alive = true;
    currentSubscription().then((s) => alive && setState(s ? "on" : "off")).catch(() => alive && setState("off"));
    return () => { alive = false; };
  }, [allowed]);

  if (!allowed) return null;

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setFailure(null);
    try { await work(); } catch (error) { setFailure(error); } finally { setBusy(false); }
  }
  const turnOn = () => run(async () => {
    const result = await enablePush(csrfToken);
    setState(result === "on" ? "on" : result === "denied" ? "denied" : result === "no_key" ? "no_key" : "unsupported");
  });
  const turnOff = () => run(async () => { await disablePush(csrfToken); setState("off"); });
  const test = () => run(async () => { toast(t((await testPush(csrfToken)) > 0 ? "pushTestSent" : "pushTestNone")); });

  const message: Record<State, string> = {
    checking: t("checking"), unsupported: t("pushUnsupported"), off: t("pushOff"), on: t("pushOn"), denied: t("pushDenied"), no_key: t("pushNoKey"),
  };
  return (
    <section className="section settings-card">
      <h2>{t("pushTitle")}</h2>
      <p className="settings-hint">{t("pushIntro")}</p>
      <p className={state === "on" ? "status ok" : "status"} role="status">{message[state]}</p>
      {state !== "unsupported" && needsHomeScreen() && <p className="notice">{t("pushIosHint")}</p>}
      {failure !== null && <ErrorNotice error={failure} />}
      <div className="settings-actions">
        {(state === "off" || state === "denied") && <Button variant="primary" icon="bell" busy={busy} onClick={() => void turnOn()}>{t("pushEnable")}</Button>}
        {state === "on" && (
          <>
            <Button busy={busy} onClick={() => void test()}>{t("pushTest")}</Button>
            <Button variant="ghost" busy={busy} onClick={() => void turnOff()}>{t("pushDisable")}</Button>
          </>
        )}
      </div>
    </section>
  );
}
