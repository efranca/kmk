import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { User } from "../api";
import { ReminderTray } from "../schedule/ReminderTray";
import AccountMenu from "./AccountMenu";
import Nav, { type NavId } from "./Nav";

export type LayoutPage = NavId | "account" | "other";

/** The frame of every signed-in page: navigation (bar or rail), the account menu, and the page area. */
export default function Layout({
  user,
  active,
  csrfToken,
  bare = false,
  onNavigate,
  onLanguageChanged,
  onSignOut,
  children,
}: {
  user: User;
  active: LayoutPage;
  csrfToken: string;
  /** Pages that draw their own surfaces (Dashboard, Schedule) skip the white card the older pages sit in. */
  bare?: boolean;
  onNavigate: (path: string) => void;
  onLanguageChanged: (user: User) => void;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="app">
      <a className="skip" href="#main">{t("skipToContent")}</a>
      <Nav active={active === "account" || active === "other" ? null : active} isAdmin={user.role !== "user"} onNavigate={onNavigate} />
      <div className="app__body">
        <header className="topbar">
          <a
            href="/"
            className="topbar__brand"
            onClick={(e) => {
              e.preventDefault();
              onNavigate("/");
            }}
          >
            <img src="/logo-horizontal.png" alt="KMK Entretien Ménager" width="108" height="36" />
          </a>
          <AccountMenu
            user={user}
            csrfToken={csrfToken}
            active={active === "account"}
            onNavigate={onNavigate}
            onLanguageChanged={onLanguageChanged}
            onSignOut={onSignOut}
          />
        </header>
        <main id="main" className="app__main">
          {bare ? children : <div className="card page">{children}</div>}
        </main>
      </div>
      <ReminderTray />
    </div>
  );
}
