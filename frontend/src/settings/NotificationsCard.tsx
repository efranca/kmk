import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { currentSubscription, disablePush, enablePush, pushSupported, testPush } from "../push";
import { usePreferences } from "../preferences";
import { useSession } from "../session";
import { Button } from "../ui/Button";
import { Toggle } from "../ui/Toggle";
import { ErrorNotice } from "../ui/Feedback";
import { useToast } from "../ui/toastContext";

type State = "checking" | "unsupported" | "off" | "on" | "denied" | "no_key";

/** iPhone only delivers web push to an app added to the Home Screen. */
function needsHomeScreen(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return /iPhone|iPad|iPod/.test(nav.userAgent) && nav.standalone === false;
}

/** What the app tells this person: an email when they are added to an event (everyone), and push on this device (admins). */
export function NotificationsCard() {
  const { t } = useTranslation();
  const toast = useToast();
  const { user, csrfToken } = useSession();
  const allowed = user.role !== "user";
  const { prefs, update } = usePreferences();
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
      <Toggle label={t("notifyAssigned")} checked={prefs.notify_assigned} onChange={(e) => update({ notify_assigned: e.target.checked })} />
      {allowed && <>
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
      </>}
    </section>
  );
}
