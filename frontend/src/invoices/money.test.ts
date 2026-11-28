import { describe, expect, it } from "vitest";

import { formatMoney, parseMoney, sumMoney } from "./money";

describe("money", () => {
  it("formats an amount in the person's language", () => {
    expect(formatMoney("195.00", "fr-CA")).toContain("195,00");
    expect(formatMoney("1234.5", "en")).toContain("1,234.50");
    expect(formatMoney("195.00", "fr-CA")).toContain("$");
  });

  it("reads what people type: comma or point, spaces, one or two decimals", () => {
    expect(parseMoney("120")).toBe("120.00");
    expect(parseMoney("120,5")).toBe("120.50");
    expect(parseMoney("120.50")).toBe("120.50");
    expect(parseMoney(" 1 234,50 ")).toBe("1234.50");
    expect(parseMoney("0")).toBe("0.00");
    expect(parseMoney("99999.99")).toBe("99999.99");
  });

  it("refuses what the server would refuse", () => {
    for (const bad of ["", "  ", "-1", "100000", "1.234", "abc", "1,2,3", "12 $", "1e3"]) expect(parseMoney(bad)).toBeNull();
  });

  it("adds in cents, so 0.10 + 0.20 is exactly 0.30", () => {
    expect(sumMoney(["0.10", "0.20"])).toBe("0.30");
    expect(sumMoney([])).toBe("0.00");
    expect(sumMoney(["120.00", "75.50", "10.00"])).toBe("205.50");
  });
});
