export const AVATAR_MAX_BYTES = 51200;
export const AVATAR_SIDE = 256;
export const AVATAR_ACCEPT = "image/jpeg,image/png,image/webp";

/**
 * Turns a chosen picture into what the server accepts: a centered square, 256 by 256, as a JPEG of at most 50 KB.
 * Re-drawing it on a canvas also drops anything that is not pixels. Rejects with Error("invalid_image") when the file is
 * not a picture the browser can read, or cannot be made small enough.
 */
export async function prepareAvatar(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("invalid_image");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("invalid_image");
  }
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = AVATAR_SIDE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("invalid_image");
  const side = Math.min(bitmap.width, bitmap.height);
  context.fillStyle = "#ffffff"; // a transparent picture gets a white background (JPEG has no transparency)
  context.fillRect(0, 0, AVATAR_SIDE, AVATAR_SIDE);
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIDE, AVATAR_SIDE);
  bitmap.close?.();
  for (const quality of [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= AVATAR_MAX_BYTES) return blob;
  }
  throw new Error("invalid_image");
}
