export const PREVIEW_SIDE = 360;
export const PREVIEW_MAX_BYTES = 60 * 1024;

const toBlob = (canvas: HTMLCanvasElement, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));

/** The canvas as a JPEG of at most 60 KB (trying lower qualities), or null when it will not get that small. */
export async function drawToJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  for (const quality of [0.8, 0.65, 0.5, 0.35]) {
    const blob = await toBlob(canvas, quality);
    if (blob && blob.size > 0 && blob.size <= PREVIEW_MAX_BYTES) return blob;
  }
  return null;
}
