import type { ReactNode } from "react";

export type ArtName = "documents" | "tasks" | "events" | "quotes";

/** Small friendly pictures for empty screens. Drawn with the theme's colours, so they follow light, dark and KMK. */
function Art({ name }: { name: ArtName }) {
  const common = { "data-art": name, viewBox: "0 0 160 120", "aria-hidden": true, focusable: false } as const;
  if (name === "documents") {
    return (
      <svg {...common}>
        <ellipse className="ea-shadow" cx="80" cy="108" rx="52" ry="6" />
        <path className="ea-back" d="M26 36a6 6 0 0 1 6-6h28l9 10h59a6 6 0 0 1 6 6v8H26z" />
        <g transform="rotate(-6 80 58)">
          <rect className="ea-paper" x="44" y="28" width="64" height="52" rx="4" />
          <path className="ea-line" d="M54 42h34M54 51h44M54 60h28" />
        </g>
        <path className="ea-front" d="M24 54a6 6 0 0 1 6-6h100a6 6 0 0 1 6 6l-5 38a8 8 0 0 1-8 7H38a8 8 0 0 1-8-7z" />
        <circle className="ea-face" cx="64" cy="72" r="3" />
        <circle className="ea-face" cx="96" cy="72" r="3" />
        <path className="ea-smile" d="M72 80q8 7 16 0" />
        <path className="ea-spark" d="M132 20v12M126 26h12M28 18v8M24 22h8" />
      </svg>
    );
  }
  if (name === "tasks") {
    return (
      <svg {...common}>
        <ellipse className="ea-shadow" cx="80" cy="108" rx="40" ry="6" />
        <rect className="ea-front" x="46" y="16" width="68" height="88" rx="8" />
        <rect className="ea-paper" x="54" y="28" width="52" height="68" rx="4" />
        <rect className="ea-clip" x="64" y="10" width="32" height="14" rx="5" />
        <rect className="ea-box" x="60" y="40" width="9" height="9" rx="2" />
        <path className="ea-check" d="M62 44.5l2.5 2.5 4-5" />
        <path className="ea-line" d="M76 44.5h22" />
        <rect className="ea-box" x="60" y="58" width="9" height="9" rx="2" />
        <path className="ea-line" d="M76 62.5h18" />
        <rect className="ea-box" x="60" y="76" width="9" height="9" rx="2" />
        <path className="ea-line" d="M76 80.5h22" />
        <path className="ea-spark" d="M26 36v10M21 41h10M132 60v8M128 64h8" />
        <circle className="ea-dot" cx="126" cy="30" r="3" />
        <circle className="ea-dot" cx="34" cy="78" r="2.5" />
      </svg>
    );
  }
  if (name === "quotes") {
    return (
      <svg {...common}>
        <ellipse className="ea-shadow" cx="80" cy="108" rx="44" ry="6" />
        <rect className="ea-front" x="58" y="74" width="8" height="32" rx="2" />
        <path className="ea-front" d="M36 74V54a22 22 0 0 1 22-22h44a22 22 0 0 1 22 22v20z" />
        <path className="ea-paper" d="M52 74V56a10 10 0 0 1 10-10h36a10 10 0 0 1 10 10v18z" />
        <path className="ea-line" d="M64 62h32" />
        <rect className="ea-paper" x="96" y="14" width="34" height="24" rx="4" transform="rotate(10 113 26)" />
        <path className="ea-line" d="M99 20l14 11 14-9" transform="rotate(10 113 26)" />
        <path className="ea-spark" d="M30 30v10M25 35h10M138 70v8M134 74h8" />
        <circle className="ea-dot" cx="22" cy="64" r="2.5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <ellipse className="ea-shadow" cx="80" cy="108" rx="48" ry="6" />
      <rect className="ea-paper" x="34" y="26" width="92" height="76" rx="10" />
      <path className="ea-front" d="M34 36a10 10 0 0 1 10-10h72a10 10 0 0 1 10 10v14H34z" />
      <path className="ea-ring" d="M56 18v16M104 18v16" />
      <path className="ea-line" d="M72 70h14l-14 14h14" />
      <path className="ea-line" d="M94 62h8l-8 8h8" />
      <circle className="ea-dot" cx="48" cy="64" r="3" />
      <circle className="ea-dot" cx="48" cy="82" r="3" />
      <circle className="ea-dot" cx="112" cy="84" r="3" />
      <circle className="ea-sun" cx="128" cy="26" r="11" />
      <path className="ea-rays" d="M128 8v5M146 26h-5M141 13l-3.5 3.5M115 13l3.5 3.5" />
    </svg>
  );
}

/** An empty screen or card: a picture, what is missing, a friendly line, and (children) what to do about it. */
export function EmptyArt({ art, title, hint, compact = false, children }: { art: ArtName; title: string; hint?: string; compact?: boolean; children?: ReactNode }) {
  return (
    <div className={compact ? "empty-art empty-art--compact" : "empty-art"}>
      <Art name={art} />
      <p className="empty-art__title">{title}</p>
      {hint && <p className="empty-art__hint">{hint}</p>}
      {children}
    </div>
  );
}
