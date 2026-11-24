import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const ICONS = ["🧹", "🧽", "🧼", "🧴", "🪣", "🧺", "🚿", "🛁", "🚽", "🪟", "🏠", "🏢", "🏬", "🚗", "🚐", "🔧", "🛠️", "🧰", "📞", "📅", "📌", "✅", "🛒", "📦", "💼", "🍽️", "🪴", "☀️", "🎉", "🩺"];

/** One emoji for an event: a button showing it, opening a small grid to pick another (or none). */
export function IconPicker({ value, onChange, label }: { value: string; onChange: (icon: string) => void; label: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);

  const pick = (icon: string) => {
    onChange(icon);
    setOpen(false);
  };

  return (
    <div className="iconpicker" ref={root}>
      <button type="button" className="iconpicker__button" aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {value || <span className="iconpicker__none" aria-hidden="true">＋</span>}
      </button>
      {open && (
        <div className="iconpicker__panel" role="group" aria-label={label}>
          <button type="button" className="iconpicker__choice iconpicker__choice--none" aria-label={t("schFormIconNone")} onClick={() => pick("")}>✕</button>
          {ICONS.map((icon) => (
            <button key={icon} type="button" className="iconpicker__choice" aria-label={icon} aria-pressed={value === icon} onClick={() => pick(icon)}>{icon}</button>
          ))}
        </div>
      )}
    </div>
  );
}
