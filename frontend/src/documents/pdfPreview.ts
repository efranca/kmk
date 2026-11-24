/**
 * The first page of a PDF as a small JPEG, drawn with pdf.js. The library and its worker are loaded only when a PDF is
 * actually chosen (the worker is a same-origin file, so the page's content policy allows it). Null when it cannot be done.
 */
import { drawToJpeg, PREVIEW_SIDE } from "./canvasJpeg";

export async function renderPdfPage(data: ArrayBuffer): Promise<Blob | null> {
  try {
    const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const task = pdfjs.getDocument({ data: new Uint8Array(data) });
    const pdf = await task.promise;
    try {
      const page = await pdf.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2, PREVIEW_SIDE / Math.max(base.width, base.height)) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      await page.render({ canvas, viewport }).promise;
      return await drawToJpeg(canvas);
    } finally {
      void task.destroy();
    }
  } catch {
    return null; // an unreadable, encrypted or odd PDF simply gets no preview
  }
}
