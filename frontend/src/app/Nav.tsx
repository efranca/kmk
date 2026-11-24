import { useTranslation } from "react-i18next";

import { Icon, type IconName } from "../ui/Icon";

export type NavId = "dashboard" | "schedule" | "admin";
type NavItem = { id: NavId; to: string; labelKey: string; icon: IconName; adminOnly?: boolean };

const ITEMS: NavItem[] = [
  { id: "dashboard", to: "/", labelKey: "navDashboard", icon: "home" },
  { id: "schedule", to: "/schedule", labelKey: "schTitle", icon: "calendar" },
  { id: "admin", to: "/admin", labelKey: "navUsers", icon: "users", adminOnly: true },
];

/** The main navigation: a bar along the bottom of a phone, a rail down the side from 768px (one element, two looks). */
export default function Nav({
  active,
  isAdmin,
  onNavigate,
}: {
  active: NavId | null;
  isAdmin: boolean;
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
      {ITEMS.filter((item) => !item.adminOnly || isAdmin).map((item) => (
        <a
          key={item.id}
          href={item.to}
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
    </nav>
  );
}
