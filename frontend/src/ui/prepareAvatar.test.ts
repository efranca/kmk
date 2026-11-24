import { afterEach, describe, expect, it, vi } from "vitest";

import { AVATAR_MAX_BYTES, AVATAR_SIDE, prepareAvatar } from "./prepareAvatar";

const file = (type = "image/png") => new File([new Uint8Array([1, 2, 3])], "me.png", { type });

function stubCanvas(sizes: number[]) {
  const draw = vi.fn();
  const context = { fillStyle: "", fillRect: vi.fn(), drawImage: draw };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const qualities: number[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb, _type, quality) => {
    qualities.push(quality as number);
    cb(new Blob([new Uint8Array(sizes.shift() ?? 1)], { type: "image/jpeg" }));
  });
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 400, height: 300, close: vi.fn() })));
  return { draw, qualities };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("prepareAvatar", () => {
  it("rejects a file that is not an image without reading it", async () => {
    await expect(prepareAvatar(file("text/html"))).rejects.toThrow("invalid_image");
  });

  it("rejects an image the browser cannot decode", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => { throw new Error("bad"); }));
    await expect(prepareAvatar(file())).rejects.toThrow("invalid_image");
  });

  it("crops the center square to 256 by 256 and returns a JPEG", async () => {
    const { draw } = stubCanvas([1000]);
    const blob = await prepareAvatar(file());
    expect(blob.type).toBe("image/jpeg");
    expect(draw).toHaveBeenCalledWith(expect.anything(), 50, 0, 300, 300, 0, 0, AVATAR_SIDE, AVATAR_SIDE);
  });

  it("lowers the quality until it fits in 50 KB", async () => {
    const { qualities } = stubCanvas([AVATAR_MAX_BYTES + 1, AVATAR_MAX_BYTES + 1, 40000]);
    const blob = await prepareAvatar(file());
    expect(blob.size).toBe(40000);
    expect(qualities).toEqual([0.9, 0.8, 0.7]);
  });

  it("gives up when it never fits", async () => {
    stubCanvas(Array(7).fill(AVATAR_MAX_BYTES + 1));
    await expect(prepareAvatar(file())).rejects.toThrow("invalid_image");
  });
});
