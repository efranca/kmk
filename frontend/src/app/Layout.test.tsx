import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers, openAccountMenu, testUser } from "../testUtils";
import Layout from "./Layout";

function setup(onNavigate = vi.fn()) {
  const view = render(
    <Providers>
      <Layout user={testUser} active="tasks" csrfToken="t" onNavigate={onNavigate} onLanguageChanged={vi.fn()} onSignOut={vi.fn()}>
        <p>content</p>
      </Layout>
    </Providers>,
  );
  return { ...view, onNavigate };
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("Layout", () => {
  it("has no top bar and keeps the account menu inside the navigation", () => {
    const { container } = setup();
    expect(container.querySelector(".topbar")).toBeNull();
    expect(container.querySelector("nav.appnav [data-account-menu]")).not.toBeNull();
  });

  it("collapses and expands the sidebar and remembers it", () => {
    const { container } = setup();
    expect(container.querySelector(".app--collapsed")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /collapse menu|réduire le menu/i }));
    expect(container.querySelector(".app--collapsed")).not.toBeNull();
    expect(localStorage.getItem("kmk.sidebar.collapsed")).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: /expand menu|agrandir le menu/i }));
    expect(container.querySelector(".app--collapsed")).toBeNull();
    expect(localStorage.getItem("kmk.sidebar.collapsed")).toBe("0");
  });

  it("starts collapsed when that was saved", () => {
    localStorage.setItem("kmk.sidebar.collapsed", "1");
    expect(setup().container.querySelector(".app--collapsed")).not.toBeNull();
  });

  it("gives every nav link a title so the collapsed rail stays readable", () => {
    const { container } = setup();
    for (const a of container.querySelectorAll<HTMLAnchorElement>("nav.appnav a[href]:not(.appnav__brand)")) expect(a.title).not.toBe("");
  });

  it("offers Settings in the account menu", () => {
    const { onNavigate } = setup();
    openAccountMenu();
    fireEvent.click(document.querySelector<HTMLElement>('.accountmenu__item[href="/settings"]')!);
    expect(onNavigate).toHaveBeenCalledWith("/settings");
  });
});
