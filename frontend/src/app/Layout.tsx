import { useClients } from "../clients/hooks";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { User } from "../api";
import { ReminderTray } from "../schedule/ReminderTray";
import AccountMenu from "./AccountMenu";
import { useSidebarCollapsed } from "./useSidebarCollapsed";
import { usePreferences } from "../preferences";
import Nav, { type NavId } from "./Nav";
import { useQuoteCounts } from "../quotes/hooks";

export type LayoutPage = NavId | "account" | "settings" | "other";

/** The frame of every signed-in page: navigation (bar or rail), the account menu, and the page area. */
export default function Layout({
  user,
  active,
  bare = false,
  onNavigate,
  onSignOut,
  children,
}: {
  user: User;
  active: LayoutPage;
  /** Pages that draw their own surfaces (Dashboard, Schedule) skip the white card the older pages sit in. */
  bare?: boolean;
  onNavigate: (path: string) => void;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [collapsed, toggle] = useSidebarCollapsed();
  const { prefs } = usePreferences();
  const waiting = useQuoteCounts(user.role !== "user").data;
  const myClients = useClients(user.role === "user").data;
  return (
    <div className={collapsed ? "app app--collapsed" : "app"}>
      <a className="skip" href="#main">{t("skipToContent")}</a>
      <Nav active={active === "account" || active === "settings" || active === "other" ? null : active} isAdmin={user.role !== "user"} isSuperAdmin={user.role === "superadmin"} hasClients={(myClients?.length ?? 0) > 0} collapsed={collapsed} badges={{ quotes: (waiting?.new ?? 0) + (waiting?.customer_replied ?? 0) }} showLabels={prefs.show_menu_labels}
        onToggle={toggle}
        onNavigate={onNavigate}
        footer={
          <AccountMenu
            user={user}
            active={active === "account"}
            settingsActive={active === "settings"}
            onNavigate={onNavigate}
            onSignOut={onSignOut}
          />
        }
      />
      <div className="app__body">
        <main id="main" className="app__main">
          {bare ? children : <div className="card page">{children}</div>}
        </main>
      </div>
      <ReminderTray />
    </div>
  );
}
