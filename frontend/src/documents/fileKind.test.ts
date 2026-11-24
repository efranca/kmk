import { describe, expect, it } from "vitest";

import { DOCUMENT_ACCEPT, extensionOf, fileKind, isAcceptedName } from "./fileKind";

describe("extensionOf", () => {
  it("is the last part, lower case", () => {
    expect(extensionOf("Report.FINAL.PDF")).toBe("pdf");
    expect(extensionOf("noextension")).toBe("");
    expect(extensionOf(".hidden")).toBe("hidden");
    expect(extensionOf(null)).toBe("");
  });
});

describe("isAcceptedName", () => {
  it.each(["a.pdf", "a.JPG", "a.jpeg", "a.png", "a.webp", "a.gif", "a.avif", "a.bmp", "a.heic", "a.heif", "a.tif", "a.tiff", "a.txt", "a.md", "a.markdown", "a.csv", "a.tsv", "a.json", "a.log", "a.rtf", "a.docx", "a.xlsx", "a.pptx", "a.odt", "a.ods", "a.odp", "a.doc", "a.xls", "a.ppt"])("accepts %s", (name) => {
    expect(isAcceptedName(name)).toBe(true);
  });
  it.each(["a.svg", "a.html", "a.zip", "a.exe", "a.sh", "a.js", "a", "a.docm", "a.epub"])("refuses %s", (name) => {
    expect(isAcceptedName(name)).toBe(false);
  });
  it("offers the same list to the file picker", () => {
    for (const ext of [".pdf", ".md", ".docx", ".heic", ".gif"]) expect(DOCUMENT_ACCEPT).toContain(ext);
    expect(DOCUMENT_ACCEPT).not.toContain("svg");
  });
});

describe("fileKind", () => {
  it("opens PDFs, drawable images and text in the tab, and nothing else", () => {
    for (const type of ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/bmp", "text/plain", "text/markdown", "text/csv", "application/json"]) {
      expect(fileKind(type, "x").inline).toBe(true);
    }
    for (const type of ["image/heic", "image/tiff", "application/rtf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]) {
      expect(fileKind(type, "x").inline).toBe(false);
    }
    expect(fileKind(null, "x").inline).toBe(false);
  });
  it("picks an icon by kind", () => {
    expect(fileKind("application/pdf", "a.pdf").icon).toBe("📄");
    expect(fileKind("image/png", "a.png").icon).toBe("🖼️");
    expect(fileKind("text/markdown", "a.md").icon).toBe("📝");
    expect(fileKind("text/csv", "a.csv").icon).toBe("📊");
    expect(fileKind("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "a.xlsx").icon).toBe("📊");
    expect(fileKind("application/vnd.openxmlformats-officedocument.presentationml.presentation", "a.pptx").icon).toBe("📽️");
    expect(fileKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "a.docx").icon).toBe("📃");
    expect(fileKind("application/rtf", "a.rtf").icon).toBe("📃");
    expect(fileKind(null, "a.zip").icon).toBe("📎");
  });
});
