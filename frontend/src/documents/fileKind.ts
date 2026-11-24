/** What the library accepts and how each kind of file is shown. The server decides again from the file's contents. */

const IMAGES = ["jpg", "jpeg", "png", "webp", "gif", "avif", "bmp", "heic", "heif", "tif", "tiff"];
const TEXT = ["txt", "md", "markdown", "csv", "tsv", "json", "log"];
const OFFICE = ["rtf", "docx", "xlsx", "pptx", "odt", "ods", "odp", "doc", "xls", "ppt"];
const EXTENSIONS = new Set(["pdf", ...IMAGES, ...TEXT, ...OFFICE]);

export const DOCUMENT_ACCEPT = [...EXTENSIONS].map((e) => `.${e}`).join(",");

export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(IMAGES);
export const TEXT_EXTENSIONS: ReadonlySet<string> = new Set(TEXT);

export function extensionOf(name: string | null): string {
  if (!name || !name.includes(".")) return "";
  return name.slice(name.lastIndexOf(".") + 1).toLowerCase();
}

export const isAcceptedName = (name: string) => EXTENSIONS.has(extensionOf(name));

/** The types a browser shows in the tab (the server sends everything else as a download). */
const INLINE = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/bmp", "text/plain", "text/markdown", "text/csv", "text/tab-separated-values", "application/json"]);

export function fileKind(contentType: string | null, name: string | null): { icon: string; inline: boolean } {
  const type = contentType ?? "";
  const inline = INLINE.has(type);
  if (type === "application/pdf") return { icon: "📄", inline };
  if (type.startsWith("image/")) return { icon: "🖼️", inline };
  if (type === "text/csv" || type === "text/tab-separated-values" || type.includes("spreadsheet") || type === "application/vnd.ms-excel") return { icon: "📊", inline };
  if (type.includes("presentation") || type === "application/vnd.ms-powerpoint") return { icon: "📽️", inline };
  if (type.startsWith("text/") || type === "application/json") return { icon: "📝", inline };
  if (type.includes("word") || type.includes("opendocument.text") || type === "application/rtf" || type === "application/msword") return { icon: "📃", inline };
  return { icon: "📎", inline };
}
