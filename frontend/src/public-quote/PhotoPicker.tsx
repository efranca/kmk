import { useEffect, useRef, useState } from "react";

export const MAX_PHOTOS = 10;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

export type PhotoProblem = { kind: "count" | "size" | "type"; name: string };

/** Whether the file may be attached (the server checks the bytes again). `null` means fine. */
export function photoProblem(file: File, already: number): PhotoProblem | null {
  const heic = /\.(heic|heif)$/i.test(file.name);
  if (already >= MAX_PHOTOS) return { kind: "count", name: file.name };
  if (!TYPES.includes(file.type) && !heic) return { kind: "type", name: file.name };
  if (file.size > MAX_PHOTO_BYTES) return { kind: "size", name: file.name };
  return null;
}

function Thumb({ file }: { file: File }) {
  const [src, setSrc] = useState<string | null>(null);
  const heic = /\.(heic|heif)$/i.test(file.name) || file.type === "image/heic";
  useEffect(() => {
    if (heic) return; // browsers cannot draw HEIC: it shows as a named tile
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" && setSrc(reader.result); // a data: URL keeps the page's CSP strict
    reader.readAsDataURL(file);
    return () => reader.abort();
  }, [file, heic]);
  return src ? <img src={src} alt="" /> : <span className="pq-thumb-name">{heic ? "HEIC" : ""}</span>;
}

export function PhotoPicker({
  files, onAdd, onRemove, label, removeLabel, disabled,
}: {
  files: File[];
  onAdd: (picked: File[]) => void;
  onRemove: (index: number) => void;
  label: string;
  removeLabel: (name: string) => string;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="pq-photos">
      <input
        ref={input} id="pq-photo-input" type="file" accept="image/jpeg,image/png,image/webp,image/heic,.heic,.heif" multiple hidden
        aria-label={label} disabled={disabled}
        onChange={(e) => {
          onAdd(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <button type="button" className="btn btn-ghost" onClick={() => input.current?.click()} disabled={disabled}>{label}</button>
      <ul className="pq-thumbs">
        {files.map((file, i) => (
          <li key={`${file.name}-${i}`}>
            <Thumb file={file} />
            <button type="button" className="pq-thumb-x" aria-label={removeLabel(file.name)} onClick={() => onRemove(i)} disabled={disabled}>×</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
