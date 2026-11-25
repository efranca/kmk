import { afterEach, describe, expect, it, vi } from "vitest";

import { applyTheme, getTheme, initTheme } from "./theme";

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks();
});

describe("theme", () => {
  it("defaults to light with empty or invalid storage", () => {
    expect(getTheme()).toBe("light");
    localStorage.setItem("kmk.theme", "purple");
    expect(getTheme()).toBe("light");
    localStorage.setItem("kmk.theme", "kmk");
    expect(getTheme()).toBe("kmk"); // a saved choice still wins
  });
  it("applyTheme sets the attribute and stores it", () => {
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("kmk.theme")).toBe("dark");
  });
  it("initTheme applies the stored theme, and light when nothing is stored (the sign-in page)", () => {
    initTheme();
    expect(document.documentElement.dataset.theme).toBe("light");
    localStorage.setItem("kmk.theme", "dark");
    initTheme();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("no"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("no"); });
    expect(getTheme()).toBe("light");
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
