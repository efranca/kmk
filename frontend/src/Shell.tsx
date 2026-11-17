import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { User } from "./api";
import LanguageSwitcher from "./LanguageSwitcher";

export type ShellPage = "welcome" | "account" | "admin" | "notfound";

/** Frame for signed-in pages: logo, navigation (by role), language switcher and sign-out. */
export default function Shell({
  user,
  active,
  csrfToken,
  onNavigate,
  onLanguageChanged,
  onSignOut,
  children,
}: {
  user: User;
  active: ShellPage;
  csrfToken: string;
  onNavigate: (path: string) => void;
  onLanguageChanged: (user: User) => void;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const link = (path: string, id: ShellPage, label: string) => (
    <a
      href={path}
      aria-current={active === id ? "page" : undefined}
      onClick={(e) => {
        e.preventDefault();
        onNavigate(path);
      }}
    >
      {label}
    </a>
  );

  return (
    <div className="shell">
      <a className="skip" href="#main">{t("skipToContent")}</a>
      <header className="shell-header">
        <a
          href="/"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            onNavigate("/");
          }}
        >
          <img src="/logo-horizontal.png" alt="KMK Entretien Ménager" width="108" height="36" />
        </a>
        <nav aria-label="KMK">
          {link("/", "welcome", t("navWelcome"))}
          {link("/account", "account", t("navAccount"))}
          {user.role !== "user" && link("/admin", "admin", t("navUsers"))}
        </nav>
        <div className="shell-right">
          <LanguageSwitcher csrfToken={csrfToken} onChanged={onLanguageChanged} />
          <button type="button" className="secondary" onClick={onSignOut}>{t("signOut")}</button>
        </div>
      </header>
      <main id="main" className="card page">{children}</main>
    </div>
  );
}
