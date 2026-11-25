import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/ui/ui.css"), "utf8");

describe("the empty-state picture's size", () => {
  it("applies to the picture only, never to the icon inside the action button", () => {
    expect(css).not.toMatch(/\.empty-art(--compact)?\s+svg/); // a descendant rule would also enlarge the "+" icon of the button
    expect(css).toMatch(/\.empty-art\s*>\s*svg\s*\{[^}]*width:\s*150px/);
    expect(css).toMatch(/\.empty-art--compact\s*>\s*svg\s*\{[^}]*width:\s*104px/);
  });
});
