import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { logout, me, type Session } from "./api";
import ForgotPassword from "./ForgotPassword";
import MfaSetup from "./MfaSetup";
import MfaVerify from "./MfaVerify";
import LoginForm from "./LoginForm";
import { useRoute } from "./route";
import SetPassword from "./SetPassword";
import SignedIn from "./SignedIn";

type State = { kind: "checking" } | { kind: "anon" } | { kind: "auth"; session: Session };

export default function App() {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<State>({ kind: "checking" });
  const [recoveryCodesLeft, setRecoveryCodesLeft] = useState<number | null>(null);
  const { path, navigate } = useRoute();

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
    setRecoveryCodesLeft(null);
    setState({ kind: "anon" });
  }

  function updateSession(patch: Partial<Session>) {
    setState((s) => (s.kind === "auth" ? { kind: "auth", session: { ...s.session, ...patch } } : s));
  }

  return (
    <main className="card">
      <img className="logo" src="/logo-horizontal.png" alt="KMK Entretien Ménager" width="300" height="100" />
      {path === "/set-password" ? (
        <SetPassword onBack={() => navigate("/")} />
      ) : path === "/forgot-password" ? (
        <ForgotPassword onBack={() => navigate("/")} />
      ) : (
        <>
          {state.kind === "checking" && <p className="status">{t("checking")}</p>}
          {state.kind === "anon" && <LoginForm onSignedIn={signedIn} onForgot={() => navigate("/forgot-password")} />}
          {state.kind === "auth" && state.session.mfa === "verify" && (
            <MfaVerify
              csrfToken={state.session.csrfToken}
              onVerified={(remaining, usedRecoveryCode) => {
                if (usedRecoveryCode && remaining <= 3) setRecoveryCodesLeft(remaining);
                updateSession({ mfa: "ok" });
              }}
              onSignOut={signOut}
            />
          )}
          {state.kind === "auth" && state.session.mfa === "setup" && (
            <MfaSetup csrfToken={state.session.csrfToken} onDone={() => updateSession({ mfa: "ok", mfaEnabled: true })} onSignOut={signOut} />
          )}
          {state.kind === "auth" && state.session.mfa === "ok" && (
            <SignedIn
              user={state.session.user}
              csrfToken={state.session.csrfToken}
              mfaEnabled={state.session.mfaEnabled}
              recoveryCodesLeft={recoveryCodesLeft}
              onMfaChange={(enabled) => updateSession({ mfaEnabled: enabled })}
              onSignOut={signOut}
            />
          )}
        </>
      )}
    </main>
  );
}
