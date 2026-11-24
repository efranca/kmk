import { describe, expect, it } from "vitest";

import { matchesSearch } from "./search";

describe("matchesSearch", () => {
  it("ignores case and accents", () => {
    expect(matchesSearch("cafe", "Café du matin")).toBe(true);
    expect(matchesSearch("JOAO", "João")).toBe(true);
  });
  it("needs every word, in any field", () => {
    expect(matchesSearch("mop office", "Mop the floor", null, "Office")).toBe(true);
    expect(matchesSearch("mop garage", "Mop the floor", "Office")).toBe(false);
  });
  it("an empty query matches everything", () => {
    expect(matchesSearch("  ", "anything")).toBe(true);
  });
});
