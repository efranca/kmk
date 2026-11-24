import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../i18n";
import en from "../locales/en.json";
import Nav from "./Nav";

let resize: (width: number) => void;

function phone(width: number) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("max-width: 639px"), addEventListener: () => undefined, removeEventListener: () => undefined }));
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: (entries: { contentRect: { width: number } }[]) => void) {}
    observe() { resize = (w) => this.callback([{ contentRect: { width: w } }]); resize(width); }
    disconnect() {}
  });
}

const nav = (props: Partial<React.ComponentProps<typeof Nav>> = {}) => (
  <Nav active="tasks" isAdmin isSuperAdmin collapsed={false} onToggle={() => undefined} footer={<span>me</span>} onNavigate={props.onNavigate ?? (() => undefined)} {...props} />
);

beforeEach(async () => { await act(() => i18n.changeLanguage("en")); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the navigation on a phone", () => {
  it("shows every page when they all fit", () => {
    phone(900);
    render(nav());
    expect(screen.queryByRole("button", { name: en.navMore })).toBeNull();
    for (const name of [en.navDashboard, en.navDocuments, en.navUsers, en.navDevices]) expect(screen.getByRole("link", { name })).toBeInTheDocument();
  });

  it("puts what does not fit behind a More button, in a sheet of links", () => {
    phone(300);
    const onNavigate = vi.fn();
    render(nav({ onNavigate }));
    const more = screen.getByRole("button", { name: en.navMore });
    expect(screen.queryByRole("link", { name: en.navDevices })).toBeNull(); // not in the bar any more
    fireEvent.click(more);
    const sheet = within(screen.getByRole("dialog", { name: en.navMoreTitle }));
    fireEvent.click(sheet.getByRole("link", { name: en.navDevices }));
    expect(onNavigate).toHaveBeenCalledWith("/devices");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("marks More as current when the open page is behind it", () => {
    phone(300);
    render(nav({ active: "devices" }));
    expect(screen.getByRole("button", { name: en.navMore })).toHaveAttribute("aria-current", "page");
  });

  it("brings the pages back when the bar gets wider", () => {
    phone(300);
    render(nav());
    expect(screen.getByRole("button", { name: en.navMore })).toBeInTheDocument();
    act(() => resize(900));
    expect(screen.queryByRole("button", { name: en.navMore })).toBeNull();
  });

  it("keeps just the icons when the names are turned off", () => {
    phone(900);
    const { container } = render(nav({ showLabels: false }));
    expect(container.querySelector("nav")).toHaveClass("appnav--icons");
    expect(screen.getByRole("link", { name: en.navDashboard })).toBeInTheDocument(); // still named for screen readers (title and text)
  });

  it("shows the names by default", () => {
    phone(900);
    const { container } = render(nav());
    expect(container.querySelector("nav")).not.toHaveClass("appnav--icons");
  });
});
