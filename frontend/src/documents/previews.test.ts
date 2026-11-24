import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./pdfPreview", () => ({ renderPdfPage: vi.fn(async () => new Blob(["pdf-page"])) }));

import { renderPdfPage } from "./pdfPreview";
import { makePreview } from "./previews";

let drawn: string[];
let sizes: number[]; // blob size to return per toBlob call
let canvases: { width: number; height: number }[];

beforeEach(() => {
  drawn = [];
  sizes = [1000];
  canvases = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    canvases.push(this);
    return { fillRect: () => undefined, fillText: (text: string) => drawn.push(text), drawImage: () => undefined, set fillStyle(_v: string) {}, set font(_v: string) {} } as unknown as CanvasRenderingContext2D;
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (cb: BlobCallback) {
    const size = sizes.length > 1 ? sizes.shift()! : sizes[0];
    cb(new Blob([new Uint8Array(size)]));
  } as never);
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 1800, height: 900, close: () => undefined })));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("makePreview", () => {
  it("scales an image to fit 360 pixels and returns a small JPEG", async () => {
    const blob = await makePreview(new File(["x"], "photo.jpg", { type: "image/jpeg" }));
    expect(blob).not.toBeNull();
    expect(canvases[0]).toMatchObject({ width: 360, height: 180 });
  });

  it("does not enlarge a small image", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 100, height: 50, close: () => undefined })));
    await makePreview(new File(["x"], "icon.png"));
    expect(canvases[0]).toMatchObject({ width: 100, height: 50 });
  });

  it("draws the first lines of a text file, cut to a sensible width", async () => {
    const text = Array.from({ length: 40 }, (_, i) => `line ${i + 1} ${"x".repeat(80)}`).join("\n");
    await makePreview(new File([text], "notes.md"));
    expect(drawn).toHaveLength(14);
    expect(drawn[0].startsWith("line 1 ")).toBe(true);
    expect(drawn.every((l) => l.length <= 44)).toBe(true);
  });

  it("asks pdf.js for the first page of a PDF", async () => {
    const blob = await makePreview(new File(["%PDF-1.4"], "lease.pdf"));
    expect(renderPdfPage).toHaveBeenCalledTimes(1);
    expect(blob).not.toBeNull();
  });

  it("tries a lower quality when the picture is too big, and gives up when it never gets small enough", async () => {
    sizes = [90_000, 70_000, 20_000];
    expect(await makePreview(new File(["x"], "a.png"))).not.toBeNull();
    sizes = [90_000];
    expect(await makePreview(new File(["x"], "b.png"))).toBeNull();
  });

  it("gives no preview for Office files and other types", async () => {
    for (const name of ["a.docx", "a.xlsx", "a.rtf", "a.zip", "noext"]) expect(await makePreview(new File(["x"], name))).toBeNull();
  });

  it("gives none (and does not throw) when the browser cannot read the picture", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => { throw new Error("cannot decode"); }));
    expect(await makePreview(new File(["x"], "photo.heic"))).toBeNull();
  });

  it("gives none when the PDF cannot be rendered", async () => {
    vi.mocked(renderPdfPage).mockResolvedValueOnce(null);
    expect(await makePreview(new File(["%PDF-"], "bad.pdf"))).toBeNull();
  });
});
