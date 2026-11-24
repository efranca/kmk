import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { IconButton } from "../ui/Button";
import type { TasksView } from "./useTasksView";

const ITEMS = '[role="menuitem"], [role="menuitemradio"]';

export type ViewOption<V extends string> = { id: V; label: string };

/**
 * The gear next to "+": how the items are shown (tasks: list or board; documents: list or tiles) and the categories.
 * While the category manager is open the gear is just the button that takes you back.
 */
export function ViewMenuButton<V extends string = TasksView>({
  view,
  onView,
  onManage,
  managing,
  views,
  menuLabel,
  heading,
}: {
  view: V;
  onView: (view: V) => void;
  onManage: () => void;
  managing: boolean;
  /** The choices; the tasks' list and board when left out. */
  views?: ViewOption<V>[];
  menuLabel?: string;
  heading?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>(ITEMS)?.focus();
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) root.current?.querySelector("button")?.focus();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      close(true);
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

  const options = views ?? ([
    { id: "list", label: t("taskViewList") },
    { id: "board", label: t("taskViewBoard") },
  ] as unknown as ViewOption<V>[]);
  const label = menuLabel ?? t("taskViewMenu");

  return (
    <span className="viewmenu" ref={root}>
      <IconButton
        icon="settings"
        label={label}
        aria-haspopup={managing ? undefined : "menu"}
        aria-expanded={managing ? undefined : open}
        aria-pressed={managing ? true : undefined}
        onClick={() => (managing ? onManage() : setOpen((o) => !o))}
      />
      {open && (
        <div ref={panel} className="viewmenu__panel" role="menu" aria-label={label} onKeyDown={onKeyDown}>
          <p className="viewmenu__heading" aria-hidden="true">{heading ?? t("taskView")}</p>
          {options.map((v) => (
            <button key={v.id} type="button" role="menuitemradio" aria-checked={view === v.id} className="viewmenu__item"
              onClick={() => { onView(v.id); close(true); }}>
              {v.label}
            </button>
          ))}
          <hr />
          <button type="button" role="menuitem" className="viewmenu__item" onClick={() => { close(false); onManage(); }}>
            {t("taskCatManage")}
          </button>
        </div>
      )}
    </span>
  );
}
