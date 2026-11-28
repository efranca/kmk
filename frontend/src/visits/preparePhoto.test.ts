import { afterEach, describe, expect, it, vi } from "vitest";

import { PHOTO_MAX_BYTES, PHOTO_SIDE, preparePhoto } from "./preparePhoto";

const file = (type = "image/jpeg") => new File([new Uint8Array([1, 2, 3])], "IMG_0001.jpg", { type });

/** A canvas that answers each toBlob with the next size, in the type `makes` says (a browser without WebP answers PNG). */
function stubCanvas(sizes: number[], makes: (asked: string) => string = (asked) => asked, picture = { width: 4000, height: 3000 }) {
  const draw = vi.fn();
  const context = { fillStyle: "", fillRect: vi.fn(), drawImage: draw };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const asked: { type: string; quality: number; width: number; height: number }[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, cb, type, quality) {
    asked.push({ type: type as string, quality: quality as number, width: this.width, height: this.height });
    cb(new Blob([new Uint8Array(sizes.shift() ?? 1)], { type: makes(type as string) }));
  });
  const close = vi.fn();
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ ...picture, close })));
  return { draw, asked, close };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("preparePhoto", () => {
  it("scales a 4000x3000 picture to 1280x960 and returns a WebP under the cap", async () => {
    const { draw, asked, close } = stubCanvas([200 * 1024]);
    const blob = await preparePhoto(file());
    expect(blob.type).toBe("image/webp");
    expect(blob.size).toBeLessThanOrEqual(PHOTO_MAX_BYTES);
    expect(draw).toHaveBeenCalledWith(expect.anything(), 0, 0, PHOTO_SIDE, 960);
    expect(asked).toEqual([{ type: "image/webp", quality: 0.75, width: 1280, height: 960 }]);
    expect(close).toHaveBeenCalled();
  });

  it("never makes a small picture bigger", async () => {
    const { asked } = stubCanvas([50_000], undefined, { width: 800, height: 1000 });
    await preparePhoto(file());
    expect(asked[0]).toMatchObject({ width: 800, height: 1000 });
  });

  it("scales a portrait picture by its height", async () => {
    const { asked } = stubCanvas([50_000], undefined, { width: 3000, height: 4000 });
    await preparePhoto(file());
    expect(asked[0]).toMatchObject({ width: 960, height: 1280 });
  });

  it("lowers the quality until the picture fits in 600 KB", async () => {
    const { asked } = stubCanvas([PHOTO_MAX_BYTES + 1, PHOTO_MAX_BYTES + 1, 400_000]);
    const blob = await preparePhoto(file());
    expect(blob.size).toBe(400_000);
    expect(asked.map((a) => a.quality)).toEqual([0.75, 0.65, 0.55]);
  });

  it("falls back to JPEG when the browser cannot make WebP", async () => {
    const { asked } = stubCanvas([300_000, 300_000], (type) => (type === "image/webp" ? "image/png" : type));
    const blob = await preparePhoto(file());
    expect(blob.type).toBe("image/jpeg");
    expect(asked.map((a) => [a.type, a.quality])).toEqual([["image/webp", 0.75], ["image/jpeg", 0.75]]);
  });

  it("gives up with photo_too_large when nothing fits", async () => {
    const { asked } = stubCanvas(Array(8).fill(PHOTO_MAX_BYTES + 1));
    await expect(preparePhoto(file())).rejects.toThrow("photo_too_large");
    expect(asked.map((a) => a.quality)).toEqual([0.75, 0.65, 0.55, 0.45]); // WebP worked, so JPEG is not tried
  });

  it("refuses a file that is not a picture", async () => {
    await expect(preparePhoto(new File(["hello"], "notes.txt", { type: "text/plain" }))).rejects.toThrow("invalid_image");
  });

  it("refuses a picture the browser cannot read", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => { throw new Error("bad"); }));
    await expect(preparePhoto(file())).rejects.toThrow("invalid_image");
  });
});
