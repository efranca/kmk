export const PHOTO_SIDE = 1280;
export const PHOTO_MAX_BYTES = 600 * 1024;
const QUALITIES = [0.75, 0.65, 0.55, 0.45];
const TYPES = ["image/webp", "image/jpeg"] as const;

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Turns a photo from the camera or the gallery into what the server accepts: the longest side at most 1280 px (never
 * made bigger), redrawn on a canvas (which drops everything that is not pixels, the GPS position phones embed included),
 * as WebP at the first quality that fits in 600 KB. A browser that cannot make WebP (it answers another type) gets JPEG
 * at the same qualities. Rejects with Error("invalid_image") for a file that is not a picture the browser can read, and
 * Error("photo_too_large") when it never gets small enough.
 */
export async function preparePhoto(file: File): Promise<Blob> {
  if (file.type && !file.type.startsWith("image/")) throw new Error("invalid_image");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file); // follows the picture's own orientation
  } catch {
    throw new Error("invalid_image");
  }
  const scale = Math.min(1, PHOTO_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close?.();
    throw new Error("invalid_image");
  }
  context.fillStyle = "#ffffff"; // a transparent picture gets a white background (JPEG has no transparency)
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  let made = false;
  for (const type of TYPES) {
    for (const quality of QUALITIES) {
      const blob = await toBlob(canvas, type, quality);
      if (!blob || blob.type !== type) break; // this browser cannot make this type: try the next one
      made = true;
      if (blob.size > 0 && blob.size <= PHOTO_MAX_BYTES) return blob;
    }
    if (made) break; // the type works, the picture is just too big at every quality
  }
  throw new Error(made ? "photo_too_large" : "invalid_image");
}
