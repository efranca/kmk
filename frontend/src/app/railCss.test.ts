import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/app/layout.css"), "utf8");
const rule = (selector: string, from = 0) => {
  const start = css.indexOf(selector, from);
  expect(start, `${selector} not found`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
};

describe("the collapsed rail", () => {
  it("draws each page as a 44px square in the middle of the rail, so the active background does not touch its edges", () => {
    const item = rule("  .appnav > a:not(.appnav__brand) { flex: none;");
    expect(item).toContain("align-self: center");
    expect(item).toContain("width: 44px");
    expect(item).toContain("height: 44px");
    expect(item).toContain("padding: 0");
  });

  it("gives the full width back when the sidebar is expanded", () => {
    const expanded = rule(".app:not(.app--collapsed) .appnav > a:not(.appnav__brand) { justify-content");
    expect(expanded).toContain("align-self: stretch");
    expect(expanded).toContain("width: auto");
    expect(expanded).toContain("height: auto");
  });
});
