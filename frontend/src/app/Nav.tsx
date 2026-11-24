import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Icon, type IconName } from "../ui/Icon";

export type NavId = "dashboard" | "schedule" | "tasks" | "documents" | "admin" | "devices";
type NavItem = { id: NavId; to: string; labelKey: string; icon: IconName; adminOnly?: boolean; superAdminOnly?: boolean };

const ITEMS: NavItem[] = [
  { id: "dashboard", to: "/", labelKey: "navDashboard", icon: "home" },
  { id: "schedule", to: "/schedule", labelKey: "schTitle", icon: "calendar" },
  { id: "tasks", to: "/tasks", labelKey: "taskTitle", icon: "tasks" },
  { id: "documents", to: "/documents", labelKey: "navDocuments", icon: "document" },
  { id: "admin", to: "/admin", labelKey: "navUsers", icon: "users", adminOnly: true },
  { id: "devices", to: "/devices", labelKey: "navDevices", icon: "devices", superAdminOnly: true },
];

/** The main navigation: a bar along the bottom of a phone, an icon rail from 768px, the full sidebar (collapsible) from 1024px. */
export default function Nav({
  active,
  isAdmin,
  isSuperAdmin,
  collapsed,
  onToggle,
  footer,
  onNavigate,
}: {
  active: NavId | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  collapsed: boolean;
  onToggle: () => void;
  /** Sits at the bottom of the sidebar (last in the phone bar): the account menu. */
  footer: ReactNode;
  onNavigate: (path: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <nav className="appnav" aria-label="KMK">
      <a
        href="/"
        className="appnav__brand"
        onClick={(e) => {
          e.preventDefault();
          onNavigate("/");
        }}
      >
        <img src="/logo-horizontal.png" alt="KMK Entretien Ménager" width="150" height="50" />
      </a>
      <button
        type="button"
        className="appnav__toggle"
        aria-label={t(collapsed ? "sidebarExpand" : "sidebarCollapse")}
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        <Icon name={collapsed ? "chev-right" : "chev-left"} size={18} />
      </button>
      {ITEMS.filter((item) => (!item.adminOnly || isAdmin) && (!item.superAdminOnly || isSuperAdmin)).map((item) => (
        <a
          key={item.id}
          href={item.to}
          title={t(item.labelKey)}
          aria-current={active === item.id ? "page" : undefined}
          onClick={(e) => {
            e.preventDefault();
            onNavigate(item.to);
          }}
        >
          <Icon name={item.icon} size={22} />
          <span>{t(item.labelKey)}</span>
        </a>
      ))}
      <div className="appnav__footer">{footer}</div>
    </nav>
  );
}
