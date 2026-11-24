import { describe, expect, it } from "vitest";

import { suggestIcon } from "./suggestIcon";

describe("suggestIcon", () => {
  it.each([
    ["Mop the floor", "🧹"],
    ["Laver les vitres", "🪟"],
    ["Limpar o banheiro", "🚽"],
    ["Buy supplies at Costco", "🛒"],
    ["Call the client", "📞"],
    ["Réparer l'aspirateur", "🔧"],
  ])("%s → %s", (title, icon) => expect(suggestIcon(title)).toBe(icon));

  it("gives nothing when no word matches, and ignores case and accents", () => {
    expect(suggestIcon("Quarterly review")).toBe("");
    expect(suggestIcon("")).toBe("");
    expect(suggestIcon("NETTOYER le BUREAU")).toBe("🧹");
  });
});
