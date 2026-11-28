import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Icon, type IconName } from "../ui/Icon";
import MoreSheet from "./MoreSheet";
import { fitTabs, MIN_TAB_PX } from "./navFit";

export type NavId = "dashboard" | "visits" | "schedule" | "tasks" | "documents" | "clients" | "quotes" | "invoices" | "admin" | "devices";
type NavItem = { id: NavId; to: string; labelKey: string; icon: IconName; adminOnly?: boolean; superAdminOnly?: boolean; staffWithClients?: boolean };

const ITEMS: NavItem[] = [
  { id: "dashboard", to: "/", labelKey: "navDashboard", icon: "home" },
  { id: "visits", to: "/visits", labelKey: "visTitle", icon: "check" },
  { id: "schedule", to: "/schedule", labelKey: "schTitle", icon: "calendar" },
  { id: "tasks", to: "/tasks", labelKey: "taskTitle", icon: "tasks" },
  { id: "documents", to: "/documents", labelKey: "navDocuments", icon: "document" },
  { id: "clients", to: "/clients", labelKey: "clientsTitle", icon: "clients", staffWithClients: true },
  { id: "quotes", to: "/quotes", labelKey: "quoteTitle", icon: "quote", adminOnly: true },
  { id: "invoices", to: "/invoices", labelKey: "invTitle", icon: "invoice", adminOnly: true },
  { id: "admin", to: "/admin", labelKey: "navUsers", icon: "users", adminOnly: true },
  { id: "devices", to: "/devices", labelKey: "navDevices", icon: "devices", superAdminOnly: true },
];

const PHONE = "(max-width: 639px)";

/** Width of the bar on a phone (0 elsewhere, or until measured): only there do pages ever move behind "More". Follows the breakpoint as it is crossed. */
function useBarWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [phone, setPhone] = useState(() => window.matchMedia?.(PHONE).matches ?? false);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const query = window.matchMedia?.(PHONE);
    if (!query) return;
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!phone || !el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0));
    observer.observe(el);
    return () => {
      observer.disconnect();
      setWidth(0);
    };
  }, [ref, phone]);
  return phone ? width : 0;
}

/** The main navigation: a bar along the bottom of a phone, an icon rail from 640px, the full sidebar (collapsible) from 1024px. */
export default function Nav({
  active,
  isAdmin,
  isSuperAdmin,
  hasClients = false,
  collapsed,
  badges,
  showLabels = true,
  onToggle,
  footer,
  onNavigate,
}: {
  active: NavId | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  /** Staff see Clients only once they are scheduled for one. */
  hasClients?: boolean;
  collapsed: boolean;
  /** A small number on a page's entry: what is waiting for the person (0 or missing shows nothing). */
  badges?: Partial<Record<NavId, number>>;
  /** Page names in the phone's bottom bar (the person can turn them off in Settings; the icons stay). */
  showLabels?: boolean;
  onToggle: () => void;
  /** Sits at the bottom of the sidebar (last in the phone bar): the account menu. */
  footer: ReactNode;
  onNavigate: (path: string) => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  const width = useBarWidth(ref);
  const [sheet, setSheet] = useState(false);
  const items = ITEMS.filter((item) => (!item.adminOnly || isAdmin) && (!item.staffWithClients || isAdmin || hasClients) && (!item.superAdminOnly || isSuperAdmin));
  // On a phone the account button takes one slot of the bar.
  const { shown, more } = fitTabs(items, width > 0 ? width - MIN_TAB_PX : 0);
  if (sheet && more.length === 0) setSheet(false); // the sheet must not reopen if the pages fit again later
  return (
    <nav className={showLabels ? "appnav" : "appnav appnav--icons"} aria-label="KMK" ref={ref}>
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
      {shown.map((item) => (
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
          {(badges?.[item.id] ?? 0) > 0 && <b className="appnav__badge" aria-label={t("navBadge", { count: badges?.[item.id] })}>{badges?.[item.id]}</b>}
        </a>
      ))}
      {more.length > 0 && (
        <>
          <button type="button" className="appnav__more" aria-haspopup="dialog" title={t("navMore")} aria-current={more.some((item) => item.id === active) ? "page" : undefined} onClick={() => setSheet(true)}>
            <Icon name="more" size={22} />
            <span>{t("navMore")}</span>
          </button>
          <MoreSheet open={sheet} onClose={() => setSheet(false)} onNavigate={onNavigate}
            items={more.map((item) => ({ to: item.to, label: t(item.labelKey), icon: item.icon, current: item.id === active }))} />
        </>
      )}
      <div className="appnav__footer">{footer}</div>
    </nav>
  );
}
