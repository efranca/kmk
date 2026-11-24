import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { IconButton } from "../ui/Button";
import type { TasksView } from "./useTasksView";

const ITEMS = '[role="menuitem"], [role="menuitemradio"]';

/**
 * The gear next to "+": how the tasks are shown (list or board) and the categories. While the category manager is
 * open the gear is just the button that takes you back.
 */
export function ViewMenuButton({
  view,
  onView,
  onManage,
  managing,
}: {
  view: TasksView;
  onView: (view: TasksView) => void;
  onManage: () => void;
  managing: boolean;
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

  const views: { id: TasksView; label: string }[] = [
    { id: "list", label: t("taskViewList") },
    { id: "board", label: t("taskViewBoard") },
  ];

  return (
    <span className="viewmenu" ref={root}>
      <IconButton
        icon="settings"
        label={t("taskViewMenu")}
        aria-haspopup={managing ? undefined : "menu"}
        aria-expanded={managing ? undefined : open}
        aria-pressed={managing ? true : undefined}
        onClick={() => (managing ? onManage() : setOpen((o) => !o))}
      />
      {open && (
        <div ref={panel} className="viewmenu__panel" role="menu" aria-label={t("taskViewMenu")} onKeyDown={onKeyDown}>
          <p className="viewmenu__heading" aria-hidden="true">{t("taskView")}</p>
          {views.map((v) => (
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
