import { describe, expect, it } from "vitest";

import { countWords } from "./words";

describe("countWords", () => {
  it("counts words split by any whitespace", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n ")).toBe(0);
    expect(countWords("  a  b\nc\t d ")).toBe(4);
  });
});
