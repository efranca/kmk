import { drawToJpeg, PREVIEW_SIDE } from "./canvasJpeg";
import { extensionOf, IMAGE_EXTENSIONS, TEXT_EXTENSIONS } from "./fileKind";

const TEXT_LINES = 14;
const TEXT_COLUMNS = 44;

async function imagePreview(file: File): Promise<Blob | null> {
  const bitmap = await createImageBitmap(file); // HEIC, TIFF and the like fail in most browsers: no preview then
  const ratio = Math.min(1, PREVIEW_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
  canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#ffffff"; // JPEG has no transparency
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return drawToJpeg(canvas);
}

async function textPreview(file: File): Promise<Blob | null> {
  const head = await file.slice(0, 4000).text();
  const lines = head.split(/\r?\n/).slice(0, TEXT_LINES).map((line) => line.replace(/\t/g, "  ").slice(0, TEXT_COLUMNS));
  const canvas = document.createElement("canvas");
  canvas.width = PREVIEW_SIDE;
  canvas.height = Math.round((PREVIEW_SIDE * 3) / 4);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#26323a";
  context.font = "12px ui-monospace, Menlo, Consolas, monospace";
  lines.forEach((line, i) => context.fillText(line, 12, 22 + i * 17));
  return drawToJpeg(canvas);
}

/**
 * A small JPEG for the tiles view: scaled for an image, the first lines for text, the first page for a PDF. Null for
 * anything else (Office files get an icon) and whenever it cannot be made: a missing preview never blocks an upload.
 */
export async function makePreview(file: File): Promise<Blob | null> {
  const ext = extensionOf(file.name);
  try {
    if (ext === "pdf") {
      const { renderPdfPage } = await import("./pdfPreview");
      return await renderPdfPage(await file.arrayBuffer());
    }
    if (TEXT_EXTENSIONS.has(ext)) return await textPreview(file);
    if (IMAGE_EXTENSIONS.has(ext)) return await imagePreview(file);
  } catch {
    return null;
  }
  return null;
}
