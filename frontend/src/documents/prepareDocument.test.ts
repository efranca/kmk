import { describe, expect, it } from "vitest";

import { prepareDocument, formatSize, levelsFor } from "./prepareDocument";

const file = (type: string, name = "a.bin", size = 10) => {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

describe("prepareDocument", () => {
  it("lets a PDF through untouched", async () => {
    const pdf = file("application/pdf", "a.pdf");
    expect(await prepareDocument(pdf)).toBe(pdf);
  });
  it("lets a small image through untouched", async () => {
    const png = file("image/png", "a.png", 1000);
    expect(await prepareDocument(png)).toBe(png);
  });
  it("accepts by the file's name, since the browser leaves the type empty for Markdown, logs and HEIC", async () => {
    for (const name of ["notes.md", "run.log", "photo.heic", "sheet.xlsx", "deck.pptx", "data.csv", "a.GIF", "letter.rtf"]) {
      const f = file("", name);
      expect(await prepareDocument(f)).toBe(f);
    }
  });
  it("refuses other kinds of file", async () => {
    for (const name of ["a.zip", "a.exe", "a.svg", "a.html", "script.sh", "noextension"]) {
      await expect(prepareDocument(file("application/octet-stream", name))).rejects.toThrow("invalid_file");
    }
  });
  it("refuses a file over 50 MB", async () => {
    await expect(prepareDocument(file("application/pdf", "big.pdf", 50 * 1024 * 1024 + 1))).rejects.toThrow("file_too_large");
  });
  it("keeps a large image as it is when it cannot be scaled (no canvas)", async () => {
    const big = file("image/jpeg", "p.jpg", 5 * 1024 * 1024);
    expect(await prepareDocument(big)).toBe(big);
  });
});

describe("formatSize", () => {
  it("reads naturally", () => {
    expect(formatSize(500)).toBe("500 B");
    expect(formatSize(2048)).toBe("2 KB");
    expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("levelsFor", () => {
  it("offers the levels up to the person's own", () => {
    expect(levelsFor("user")).toEqual([]);
    expect(levelsFor("admin")).toEqual(["everyone", "admins"]);
    expect(levelsFor("superadmin")).toEqual(["everyone", "admins", "superadmin"]);
  });
});
