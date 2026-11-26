import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/schedule/schedule.css"), "utf8");
const rule = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} not found`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
};
const px = (block: string, prop: string) => {
  const m = block.match(new RegExp(`(?:^|[;{\\s])${prop}:\\s*(\\d+)px`));
  return m ? Number(m[1]) : null;
};

describe("the event dialog's color swatches", () => {
  it("are round: the global button min-height (44px) must not stretch them taller than wide", () => {
    const swatch = rule(".sched-colors__swatch");
    const width = px(swatch, "width");
    expect(width).not.toBeNull();
    expect(px(swatch, "height")).toBe(width);
    expect(px(swatch, "min-height") ?? (swatch.includes("min-height: 0") ? 0 : null), "min-height must be set").not.toBeNull();
    expect(px(swatch, "min-height") ?? 0).toBeLessThanOrEqual(width!);
    expect(swatch).toContain("flex: none");
  });
});
