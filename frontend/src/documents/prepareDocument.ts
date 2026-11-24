import { MAX_FILE_BYTES, type Visibility } from "./api";
import { isAcceptedName } from "./fileKind";

export { DOCUMENT_ACCEPT } from "./fileKind";
const SCALABLE = new Set(["image/jpeg", "image/png", "image/webp", "image/bmp"]); // a GIF keeps its frames, HEIC and the like are left alone
const SCALE_ABOVE_BYTES = 1.5 * 1024 * 1024;
const LONGEST_SIDE = 2400;

/**
 * Checks a chosen file and, for a big photo, scales it down (longest side 2400 px, JPEG) so it stays readable and small.
 * PDFs and small images go as they are. Rejects with Error("invalid_file") or Error("file_too_large"); the server checks
 * both again (by the file's first bytes).
 */
export async function prepareDocument(file: File): Promise<File> {
  if (!isAcceptedName(file.name)) throw new Error("invalid_file"); // the browser's type is empty for Markdown, logs and the like
  let result = file;
  if (SCALABLE.has(file.type) && file.size > SCALE_ABOVE_BYTES) result = (await scaleDown(file)) ?? file;
  if (result.size > MAX_FILE_BYTES) throw new Error("file_too_large");
  return result;
}

async function scaleDown(file: File): Promise<File | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const ratio = Math.min(1, LONGEST_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * ratio);
    canvas.height = Math.round(bitmap.height * ratio);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return null;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return null; // not readable as a picture here: the original goes as it is
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The visibility levels a person may give a document: up to their own (the server decides again). */
export function levelsFor(role: "user" | "admin" | "superadmin"): Visibility[] {
  return role === "superadmin" ? ["everyone", "admins", "superadmin"] : role === "admin" ? ["everyone", "admins"] : [];
}
