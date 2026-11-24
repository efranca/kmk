import { describe, expect, it } from "vitest";

import { appVersion } from "../scripts/appVersion";

describe("appVersion", () => {
  it("uses major.minor from the package and the commit count as the third number", () => {
    expect(appVersion("0.2.0", 57)).toBe("0.2.57");
  });
  it("keeps the package version without a usable count", () => {
    expect(appVersion("0.2.0", null)).toBe("0.2.0");
  });
  it("tolerates a package version without a minor", () => {
    expect(appVersion("1", 9)).toBe("1.0.9");
  });
});
