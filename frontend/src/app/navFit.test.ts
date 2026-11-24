import { describe, expect, it } from "vitest";

import { fitTabs } from "./navFit";

const items = ["a", "b", "c", "d", "e", "f"];

describe("fitTabs", () => {
  it("keeps everything when the width is unknown", () => {
    expect(fitTabs(items, 0)).toEqual({ shown: items, more: [] });
  });
  it("keeps everything when it all fits", () => {
    expect(fitTabs(items, 6 * 64)).toEqual({ shown: items, more: [] });
    expect(fitTabs(items, 900)).toEqual({ shown: items, more: [] });
  });
  it("moves what does not fit behind More, keeping a slot for the More button itself", () => {
    expect(fitTabs(items, 5 * 64)).toEqual({ shown: ["a", "b", "c", "d"], more: ["e", "f"] });
    expect(fitTabs(items, 4 * 64)).toEqual({ shown: ["a", "b", "c"], more: ["d", "e", "f"] });
  });
  it("always keeps at least one tab beside More, however narrow", () => {
    expect(fitTabs(items, 10)).toEqual({ shown: ["a"], more: ["b", "c", "d", "e", "f"] });
  });
  it("never loses an item", () => {
    for (let width = 1; width < 500; width += 7) {
      const { shown, more } = fitTabs(items, width);
      expect([...shown, ...more]).toEqual(items);
    }
  });
});
