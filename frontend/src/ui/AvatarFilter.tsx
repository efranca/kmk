import { useEffect, useRef, useState } from "react";

import { Avatar, type Person } from "./Avatar";
import { EveryoneAvatar } from "./AvatarGroup";

interface Props {
  people: Person[];
  /** The picked people's ids; none = everyone. */
  selected: number[];
  onChange: (ids: number[]) => void;
  /** The group's name for screen readers. */
  label: string;
  everyoneLabel: string;
  /** Names the "+N" button, e.g. "5 more people". */
  moreLabel: (count: number) => string;
  /** How many faces show before the rest go behind "+N". */
  max: number;
  size?: "sm" | "md";
  disabled?: boolean;
  /** Each face with its name under it (shortened if need be), in one row: for a form with room. */
  showNames?: boolean;
}

/**
 * Pick people by their faces (any number of them), in one row: first "Everyone" (the people icon), then the faces,
 * overlapping a little; with many people the first `max` show and the rest are behind a "+N" that opens a list with a
 * checkbox, face and name for each.
 */
export function AvatarFilter({ people, selected, onChange, label, everyoneLabel, moreLabel, max, size = "md", disabled = false, showNames = false }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const shown = people.slice(0, max);
  const rest = people.slice(max);
  const restPicked = rest.some((p) => selected.includes(p.id));

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const toggle = (id: number) => onChange(people.map((p) => p.id).filter((x) => (x === id ? !selected.includes(id) : selected.includes(x))));

  return (
    <div
      className={`avatarfilter ${showNames ? "avatarfilter--names" : ""}`}
      role="group"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <span className={`avatargroup avatargroup--${size} ${showNames ? "avatargroup--apart" : ""}`}>
        <button type="button" className="avatarpick" aria-pressed={selected.length === 0} aria-label={everyoneLabel} title={everyoneLabel} disabled={disabled} onClick={() => onChange([])}>
          <EveryoneAvatar size={size} label={everyoneLabel} />
          {showNames && <span className="avatarpick__name" aria-hidden="true">{everyoneLabel}</span>}
        </button>
        {shown.map((p) => (
          <button key={p.id} type="button" className="avatarpick" aria-pressed={selected.includes(p.id)} aria-label={p.name} title={p.name} disabled={disabled} onClick={() => toggle(p.id)}>
            <Avatar person={p} size={size} />
            {showNames && <span className="avatarpick__name" aria-hidden="true">{p.name}</span>}
          </button>
        ))}
        {rest.length > 0 && (
          <span className="avatarpop-host" ref={root}>
            <button
              type="button"
              className="avatarpick avatarpick--more"
              aria-haspopup="true"
              aria-expanded={open}
              aria-label={moreLabel(rest.length)}
              title={moreLabel(rest.length)}
              data-picked={restPicked || undefined}
              disabled={disabled}
              onClick={() => setOpen((o) => !o)}
            >
              <span className="avatarmore">+{rest.length}</span>
            </button>
            {open && (
              <div className="avatarpop" role="group" aria-label={moreLabel(rest.length)}>
                {rest.map((p) => (
                  <label key={p.id} className="avatarpop__row">
                    <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
                    <Avatar person={p} size="md" />
                    <span>{p.name}</span>
                  </label>
                ))}
              </div>
            )}
          </span>
        )}
      </span>
    </div>
  );
}
