import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import AccountPage from "./AccountPage";
import AdminPage from "./AdminPage";
import { logout, me, type Session, type User } from "./api";
import ForgotPassword from "./ForgotPassword";
import LanguagePicker from "./LanguagePicker";
import { rememberLanguage, savedLanguage } from "./lang";
import LoginForm from "./LoginForm";
import MfaSetup from "./MfaSetup";
import MfaVerify from "./MfaVerify";
import NotFound from "./NotFound";
import { useRoute } from "./route";
import SetPassword from "./SetPassword";
import Shell, { type ShellPage } from "./Shell";
import WelcomePage from "./WelcomePage";

type State = { kind: "checking" } | { kind: "anon" } | { kind: "auth"; session: Session };
type Page = "checking" | "signin" | "forgot" | "setpw" | "verify" | "setup" | "welcome" | "account" | "admin" | "notfound";

const BRAND = "KMK Entretien Ménager";
const TITLE_KEYS: Record<Page, string | null> = {
  checking: null,
  signin: "signInTitle",
  forgot: "forgotTitle",
  setpw: "setPasswordTitle",
  verify: "mfaCodeTitle",
  setup: "mfaSetupTitle",
  welcome: "navWelcome",
  account: "navAccount",
  admin: "adminTitle",
  notfound: "notFoundTitle",
};

function pageFor(path: string, state: State): Page {
  if (path === "/set-password") return "setpw";
  if (path === "/forgot-password") return "forgot";
  if (state.kind === "checking") return "checking";
  if (state.kind === "anon") return ["/", "/account", "/admin"].includes(path) ? "signin" : "notfound";
  if (state.session.mfa === "verify") return "verify";
  if (state.session.mfa === "setup") return "setup";
  if (path === "/") return "welcome";
  if (path === "/account") return "account";
  if (path === "/admin") return state.session.user.role !== "user" ? "admin" : "welcome"; // plain users just see the welcome page
  return "notfound";
}

export default function App() {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<State>({ kind: "checking" });
  const [recoveryCodesLeft, setRecoveryCodesLeft] = useState<number | null>(null);
  const { path, navigate } = useRoute();

  const page = pageFor(path, state);

  useEffect(() => {
    const key = TITLE_KEYS[page];
    document.title = key ? `${t(key)} · ${BRAND}` : BRAND;
  }, [page, t, i18n.language]);

  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  function applyLanguage(user: User) {
    void i18n.changeLanguage(user.locale);
    rememberLanguage(user.locale); // the sign-in page on this browser will already be in their language
  }

  useEffect(() => {
    let alive = true;
    me().then((session) => {
      if (!alive) return;
      if (session) {
        applyLanguage(session.user);
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
    applyLanguage(session.user);
    setState({ kind: "auth", session });
  }

  async function signOut() {
    if (state.kind === "auth") await logout(state.session.csrfToken);
    void i18n.changeLanguage(savedLanguage() ?? "fr-CA");
    setRecoveryCodesLeft(null);
    setState({ kind: "anon" });
  }

  function updateSession(patch: Partial<Session>) {
    setState((s) => (s.kind === "auth" ? { kind: "auth", session: { ...s.session, ...patch } } : s));
  }

  // Pages with their own centered card (people who are not signed in, and the two-step screens).
  const card = (content: ReactNode, withPicker: boolean) => (
    <main className="card">
      {withPicker && <LanguagePicker />}
      <img className="logo" src="/logo-horizontal.png" alt={BRAND} width="300" height="100" />
      {content}
    </main>
  );

  switch (page) {
    case "setpw":
      return card(<SetPassword onBack={() => navigate("/")} />, true);
    case "forgot":
      return card(<ForgotPassword onBack={() => navigate("/")} />, true);
    case "checking":
      return card(<p className="status">{t("checking")}</p>, false);
    case "signin":
      return card(<LoginForm onSignedIn={signedIn} onForgot={() => navigate("/forgot-password")} />, true);
    case "notfound":
      if (state.kind !== "auth") return card(<NotFound onHome={() => navigate("/")} />, true);
      break;
    case "verify":
    case "setup": {
      if (state.kind !== "auth") return null;
      const { session } = state;
      return card(
        page === "verify" ? (
          <MfaVerify
            csrfToken={session.csrfToken}
            onVerified={(remaining, usedRecoveryCode) => {
              if (usedRecoveryCode && remaining <= 3) setRecoveryCodesLeft(remaining);
              updateSession({ mfa: "ok" });
            }}
            onSignOut={signOut}
          />
        ) : (
          <MfaSetup csrfToken={session.csrfToken} onDone={() => updateSession({ mfa: "ok", mfaEnabled: true })} onSignOut={signOut} />
        ),
        false,
      );
    }
  }

  if (state.kind !== "auth") return null;
  const { session } = state;
  const shellPage: ShellPage = page === "welcome" || page === "account" || page === "admin" ? page : "notfound";

  return (
    <Shell
      user={session.user}
      active={shellPage}
      csrfToken={session.csrfToken}
      onNavigate={navigate}
      onLanguageChanged={(user) => updateSession({ user })}
      onSignOut={signOut}
    >
      {page === "welcome" && <WelcomePage user={session.user} mfaEnabled={session.mfaEnabled} recoveryCodesLeft={recoveryCodesLeft} />}
      {page === "account" && (
        <AccountPage
          user={session.user}
          csrfToken={session.csrfToken}
          mfaEnabled={session.mfaEnabled}
          recoveryCodesLeft={recoveryCodesLeft}
          onMfaChange={(enabled) => updateSession({ mfaEnabled: enabled })}
        />
      )}
      {page === "admin" && <AdminPage session={session} />}
      {page === "notfound" && <NotFound onHome={() => navigate("/")} />}
    </Shell>
  );
}
