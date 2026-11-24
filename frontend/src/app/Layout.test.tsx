import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PREFERENCES, type Preferences } from "../preferences";
import { Providers, openAccountMenu, testUser } from "../testUtils";
import Layout from "./Layout";

function setup(onNavigate = vi.fn(), preferences?: Preferences) {
  const view = render(
    <Providers preferences={preferences}>
      <Layout user={testUser} active="tasks" csrfToken="t" onNavigate={onNavigate} onLanguageChanged={vi.fn()} onSignOut={vi.fn()}>
        <p>content</p>
      </Layout>
    </Providers>,
  );
  return { ...view, onNavigate };
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 }))));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
    fireEvent.click(screen.getByRole("button", { name: /expand menu|agrandir le menu/i }));
    expect(container.querySelector(".app--collapsed")).toBeNull();
  });

  it("starts collapsed when the account says so", () => {
    expect(setup(vi.fn(), { ...DEFAULT_PREFERENCES, sidebar_collapsed: true }).container.querySelector(".app--collapsed")).not.toBeNull();
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
