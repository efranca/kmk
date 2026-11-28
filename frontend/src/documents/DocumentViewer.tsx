import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const MAX_PDF_PAGES = 40;
const MAX_TEXT_CHARS = 200_000;

/**
 * The page's content policy allows no frames, so a PDF cannot sit in an <iframe>. It is read here and drawn page by page
 * with pdf.js instead (the library and its worker are same-origin files, loaded only when a PDF is opened). It also works
 * on a phone, where browsers do not show PDFs inside a page.
 */
export function PdfViewer({ url }: { url: string }) {
  const { t } = useTranslation();
  const holder = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [more, setMore] = useState(false);

  useEffect(() => {
    let alive = true;
    let destroy: (() => void) | undefined;
    void (async () => {
      try {
        const response = await fetch(url, { credentials: "same-origin" });
        if (!response.ok) throw new Error("fetch");
        const data = new Uint8Array(await response.arrayBuffer());
        const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const task = pdfjs.getDocument({ data });
        destroy = () => void task.destroy();
        const pdf = await task.promise;
        const box = holder.current;
        if (!alive || !box) return;
        const width = Math.max(240, box.clientWidth || 600);
        const pages = Math.min(pdf.numPages, MAX_PDF_PAGES);
        setMore(pdf.numPages > pages);
        for (let n = 1; n <= pages && alive; n++) {
          const page = await pdf.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const ratio = Math.min(2, window.devicePixelRatio || 1);
          const viewport = page.getViewport({ scale: (width / base.width) * ratio });
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          canvas.className = "doc-pdf__page";
          canvas.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
          await page.render({ canvas, viewport }).promise;
          if (!alive) return;
          box.appendChild(canvas);
          if (n === 1) setState("ready");
        }
      } catch {
        if (alive) setState("failed");
      }
    })();
    return () => {
      alive = false;
      destroy?.();
    };
  }, [url]);

  return (
    <div className="doc-view doc-view--pdf" aria-label={t("docViewerLabel")}>
      {state === "loading" && <p className="muted doc-view__note">{t("docViewerLoading")}</p>}
      {state === "failed" && <p className="muted doc-view__note" role="alert">{t("docViewerFailed")}</p>}
      <div ref={holder} className="doc-pdf" />
      {more && <p className="muted doc-view__note">{t("docViewerMore", { count: MAX_PDF_PAGES })}</p>}
    </div>
  );
}

/** A plain-text file (notes, CSV, JSON…), read here and shown as text: it is never run as a page. */
export function TextViewer({ url }: { url: string }) {
  const { t } = useTranslation();
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const response = await fetch(url, { credentials: "same-origin" });
        if (!response.ok) throw new Error("fetch");
        const body = await response.text();
        if (alive) setText(body.length > MAX_TEXT_CHARS ? `${body.slice(0, MAX_TEXT_CHARS)}\n…` : body);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [url]);

  if (failed) return <p className="muted doc-view__note" role="alert">{t("docViewerFailed")}</p>;
  if (text === null) return <p className="muted doc-view__note">{t("docViewerLoading")}</p>;
  return <pre className="doc-view doc-view--text">{text}</pre>;
}
