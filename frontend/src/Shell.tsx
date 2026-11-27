import type { ReactNode } from "react";

import type { User } from "./api";
import Layout, { type LayoutPage } from "./app/Layout";

export type ShellPage = "welcome" | "schedule" | "tasks" | "documents" | "clients" | "quotes" | "account" | "admin" | "devices" | "settings" | "notfound";

const PAGE_TO_LAYOUT: Record<ShellPage, LayoutPage> = { welcome: "dashboard", schedule: "schedule", tasks: "tasks", documents: "documents", clients: "clients", quotes: "quotes", account: "account", settings: "settings", admin: "admin", devices: "devices", notfound: "other" };

/** Frame for signed-in pages (see app/Layout): navigation by role, the account menu, and the page area. */
export default function Shell({
  user,
  active,
  onNavigate,
  onSignOut,
  bare,
  children,
}: {
  user: User;
  active: ShellPage;
  onNavigate: (path: string) => void;
  onSignOut: () => void;
  /** Pages that draw their own surfaces skip the white card. */
  bare?: boolean;
  children: ReactNode;
}) {
  return (
    <Layout
      user={user}
      active={PAGE_TO_LAYOUT[active]}
      onNavigate={onNavigate}
      onSignOut={onSignOut}
      bare={bare}
    >
      {children}
    </Layout>
  );
}
