import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { logout, me, type Session } from "./api";
import LoginForm from "./LoginForm";
import SignedIn from "./SignedIn";

type State = { kind: "checking" } | { kind: "anon" } | { kind: "auth"; session: Session };

export default function App() {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<State>({ kind: "checking" });

  useEffect(() => {
    document.title = "KMK Entretien Ménager";
  }, []);

  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  useEffect(() => {
    let alive = true;
    me().then((session) => {
      if (!alive) return;
      if (session) {
        void i18n.changeLanguage(session.user.locale);
        setState({ kind: "auth", session });
      } else {
        setState({ kind: "anon" });
      }
    });
    return () => {
      alive = false;
    };
    // Run once on load; re-running on language changes would re-check the session and could reset the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function signedIn(session: Session) {
    void i18n.changeLanguage(session.user.locale);
    setState({ kind: "auth", session });
  }

  async function signOut() {
    if (state.kind === "auth") await logout(state.session.csrfToken);
    void i18n.changeLanguage("fr-CA");
    setState({ kind: "anon" });
  }

  return (
    <main className="card">
      <img className="logo" src="/logo-horizontal.png" alt="KMK Entretien Ménager" width="300" height="100" />
      {state.kind === "checking" && <p className="status">{t("checking")}</p>}
      {state.kind === "anon" && <LoginForm onSignedIn={signedIn} />}
      {state.kind === "auth" && <SignedIn user={state.session.user} onSignOut={signOut} />}
    </main>
  );
}
