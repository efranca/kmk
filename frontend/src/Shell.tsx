import type { ReactNode } from "react";

import type { User } from "./api";
import Layout, { type LayoutPage } from "./app/Layout";

export type ShellPage = "welcome" | "account" | "admin" | "notfound";

const PAGE_TO_LAYOUT: Record<ShellPage, LayoutPage> = { welcome: "dashboard", account: "account", admin: "admin", notfound: "other" };

/** Frame for signed-in pages (see app/Layout): navigation by role, the account menu, and the page area. */
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
  return (
    <Layout
      user={user}
      active={PAGE_TO_LAYOUT[active]}
      csrfToken={csrfToken}
      onNavigate={onNavigate}
      onLanguageChanged={onLanguageChanged}
      onSignOut={onSignOut}
    >
      {children}
    </Layout>
  );
}
