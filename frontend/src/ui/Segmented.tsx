import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { Icon } from "./Icon";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface Props<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** The group's accessible name. */
  label: string;
  /** Show a dropdown instead of the pills (a phone, where the pills do not fit). */
  dropdown?: boolean;
}

const ITEMS = '[role="menuitemradio"]';

function SegmentedMenu<T extends string>({ options, value, onChange, label }: Omit<Props<T>, "dropdown">) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    (panel.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? panel.current?.querySelector<HTMLElement>(ITEMS))?.focus();
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  function close() {
    setOpen(false);
    root.current?.querySelector("button")?.focus();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === "Tab") {
      setOpen(false);
      return;
    }
    const items = [...(panel.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to = e.key === "ArrowDown" ? (at + 1) % items.length : e.key === "ArrowUp" ? (at - 1 + items.length) % items.length : -1;
    if (to >= 0) {
      e.preventDefault();
      items[to]?.focus();
    }
  }

  return (
    <div className="segmented-menu" ref={root}>
      <button type="button" className="segmented-menu__button" aria-haspopup="menu" aria-expanded={open} aria-label={`${label}: ${current?.label ?? ""}`} onClick={() => setOpen((o) => !o)}>
        <span>{current?.label}</span>
        <Icon name="chev-down" size={16} />
      </button>
      {open && (
        <div ref={panel} className="segmented-menu__panel" role="menu" aria-label={label} onKeyDown={onKeyDown}>
          {options.map((o) => (
            <button key={o.value} type="button" role="menuitemradio" aria-checked={value === o.value} className="segmented-menu__item" disabled={o.disabled}
              onClick={() => { onChange(o.value); close(); }}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** One choice out of a few, as a pill-shaped switch (the Schedule's Day / Week / Month / Year). */
export function Segmented<T extends string>({ options, value, onChange, label, dropdown }: Props<T>) {
  if (dropdown) return <SegmentedMenu options={options} value={value} onChange={onChange} label={label} />;
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className="segmented__option"
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
