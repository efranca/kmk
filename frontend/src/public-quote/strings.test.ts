import { describe, expect, it } from "vitest";

import { initialLocale, STRINGS, translate } from "./strings";

describe("public form strings", () => {
  it("has the same keys in the three languages", () => {
    const fr = Object.keys(STRINGS["fr-CA"]).sort();
    expect(Object.keys(STRINGS["en-CA"]).sort()).toEqual(fr);
    expect(Object.keys(STRINGS["pt-BR"]).sort()).toEqual(fr);
  });
  it("has no empty string", () => {
    for (const locale of Object.values(STRINGS)) for (const value of Object.values(locale)) expect(value.trim()).not.toBe("");
  });
  it("picks the language from ?lang, then the browser, then French", () => {
    expect(initialLocale("?lang=en", "fr-CA")).toBe("en-CA");
    expect(initialLocale("?lang=pt", "en-US")).toBe("pt-BR");
    expect(initialLocale("?lang=fr", "en-US")).toBe("fr-CA");
    expect(initialLocale("", "pt-BR")).toBe("pt-BR");
    expect(initialLocale("", "en-GB")).toBe("en-CA");
    expect(initialLocale("", "de")).toBe("fr-CA");
    expect(initialLocale("?lang=zz", "")).toBe("fr-CA");
  });
  it("asks for a short city as well as the address", () => {
    expect(translate("en-CA", "pqCity")).toBe("City");
    expect(translate("fr-CA", "pqCity")).toBe("Ville");
    expect(translate("pt-BR", "pqCity")).toBe("Cidade");
  });
  it("fills {{variables}}", () => {
    expect(translate("en-CA", "pqWords", { n: 5, max: 2000 })).toBe("5 / 2000 words");
  });
});
