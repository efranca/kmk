import { afterEach, describe, expect, it, vi } from "vitest";

import { applyTheme, getTheme, initTheme } from "./theme";

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks();
});

describe("theme", () => {
  it("defaults to kmk with empty or invalid storage", () => {
    expect(getTheme()).toBe("kmk");
    localStorage.setItem("kmk.theme", "purple");
    expect(getTheme()).toBe("kmk");
  });
  it("applyTheme sets the attribute and stores it", () => {
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("kmk.theme")).toBe("dark");
  });
  it("initTheme applies the stored theme", () => {
    localStorage.setItem("kmk.theme", "light");
    initTheme();
    expect(document.documentElement.dataset.theme).toBe("light");
  });
  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("no"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("no"); });
    expect(getTheme()).toBe("kmk");
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
