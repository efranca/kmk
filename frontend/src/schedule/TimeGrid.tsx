import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";

import { eventColorVar } from "../ui/memberColor";
import { moveSlot, resizeSlot, sameSlot, timeOfMinutes, type Slot } from "./dragMove";
import { busyHours, hourBands, layoutColumn, minutesAt, positionOf, toMinutes, unionWindow, windowFor, type GridItem } from "./gridLayout";
import { isWeekend } from "./scheduleDates";
import { ScheduleChip } from "./ScheduleChip";
import { TaskChip, type TaskLayer } from "./TaskChip";
import type { Occurrence } from "./types";

const HOUR_PX = 56;
const MAX_HOUR_PX = 120; // a big screen with few busy hours: the hours stretch, up to here
const pad = (n: number) => String(n).padStart(2, "0");
const hourLabel = (h: number) => `${pad(h)}:00`;
const keyOf = (item: Occurrence) => `${item.event_id}-${item.original_date}`;

interface Entry extends GridItem {
  item: Occurrence;
}

interface TimeGridProps {
  /** The days shown, left to right (one for the Day view, seven for the Week view). */
  days: string[];
  items: Occurrence[];
  today: string;
  locale: string;
  onOpenItem?: (item: Occurrence) => void;
  /** An empty spot of a day was clicked: the day and the minute of the day, rounded to 30 minutes. */
  onCreateAt?: (date: string, minutes: number) => void;
  /** An event was dragged to another time or day, or resized: where it now is. When absent, events can't be dragged. */
  onMoveEvent?: (item: Occurrence, slot: { date: string; start: string; end: string }) => void;
  /** Which events may be dragged (the person may change them); all of them when absent. */
  canMove?: (item: Occurrence) => boolean;
  /** Tasks to show in the all-day strip of their due day, when the switch is on. */
  tasks?: TaskLayer;
}

/** A drag or resize under way: what the ghost shows. */
interface Drag { key: string; mode: "move" | "resize"; slot: Slot }
interface Gesture {
  item: Occurrence; key: string; mode: "move" | "resize"; original: Slot; pointerId: number; startX: number; startY: number;
  grabMin: number; active: boolean; touch: boolean; timer?: ReturnType<typeof setTimeout>; latest: Slot;
}

const LONG_PRESS_MS = 350; // on a touch screen a drag starts after a press, so scrolling the day still works

/**
 * Hours down the side, one column per day, events as blocks at their time. The whole day is there: the grid opens on
 * the working hours and the hours before and after are a scroll away (shaded). Hours with nothing in them on any day
 * shown are compacted, which leaves the room to the hours in use. All-day events sit in a strip on top, which stays in
 * view while the hours scroll. Weekend columns are tinted. An event can be dragged to another time or day, and its bottom
 * edge dragged to change how long it lasts (on a touch screen after pressing it for a moment); both snap to a quarter
 * of an hour and are reported to `onMoveEvent`.
 */
export function TimeGrid({ days, items, today, locale, onOpenItem, onCreateAt, onMoveEvent, canMove, tasks }: TimeGridProps) {
  const { t } = useTranslation();
  const window = unionWindow(days);
  const timed = days.flatMap((d) => items.filter((i) => i.date === d && !i.all_day && i.start_time));
  const busyKey = timed.map((i) => {
    const start = toMinutes(i.start_time!);
    return `${start}-${i.end_time ? toMinutes(i.end_time) : start + 60}`;
  }).join(",");
  const bands = useMemo(
    () =>
      hourBands(
        busyHours(
          busyKey
            ? busyKey.split(",").map((s) => {
                const [startMin, endMin] = s.split("-").map(Number) as [number, number];
                return { startMin, endMin };
              })
            : [],
        ),
      ),
    [busyKey],
  );
  const weight = bands.reduce((sum, b) => sum + b.weight, 0);
  const [fit, setFit] = useState<{ hourPx: number; room: number | null }>({ hourPx: HOUR_PX, room: null });
  const height = weight * fit.hourPx;
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short" });
  const hours = bands.flatMap((b) => Array.from({ length: b.to - b.from }, (_, k) => b.from + k));

  const scroller = useRef<HTMLDivElement>(null);
  // On a tablet or desktop the grid fills the screen down to the page's bottom margin: when the hours in use take less
  // room than that, each hour grows (so no empty band under the grid); when they take more, the grid scrolls.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      if (globalThis.innerWidth < 768) {
        setFit((f) => (f.room === null && f.hourPx === HOUR_PX ? f : { hourPx: HOUR_PX, room: null }));
        return;
      }
      const room = Math.floor(globalThis.innerHeight - el.getBoundingClientRect().top - 32);
      const heads = el.scrollHeight - (el.querySelector<HTMLElement>(".grid__rail")?.offsetHeight ?? 0); // day names and the all-day strip
      const hourPx = Math.min(MAX_HOUR_PX, Math.max(HOUR_PX, Math.floor((room - heads) / weight)));
      setFit((f) => (f.room === room && f.hourPx === hourPx ? f : { hourPx, room }));
    };
    measure();
    globalThis.addEventListener("resize", measure);
    return () => globalThis.removeEventListener("resize", measure);
  }); // after every render: the strip on top changes height with the events of the days shown
  // Open focused on the working hours; again when the days or the hours change.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = positionOf(bands, window.start * 60) * height;
  }, [days[0], days.length, window.start]); // eslint-disable-line react-hooks/exhaustive-deps

  const byDay = (date: string) => items.filter((i) => i.date === date);

  // ---- dragging and resizing ----
  const columns = useRef(new Map<string, HTMLDivElement>());
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const live = useRef({ bands, onMoveEvent });
  useEffect(() => { live.current = { bands, onMoveEvent }; });

  // The handlers live in one object made once: they are added to and removed from `window`, so they must be the same
  // functions each time. They read what changes (the bands, the callback) through `live`.
  const dnd = useMemo(() => {
    /** The day column under a point (the fallback when it is outside all of them) and the minute of the day at its height. */
    function pointAt(x: number, y: number, fallbackDate: string): { date: string; minutes: number } {
      let date = fallbackDate;
      for (const [d, el] of columns.current) {
        const r = el.getBoundingClientRect();
        if (x >= r.left && x < r.right) { date = d; break; }
      }
      const rect = columns.current.get(date)?.getBoundingClientRect();
      return { date, minutes: minutesAt(live.current.bands, rect && rect.height ? (y - rect.top) / rect.height : 0) };
    }

    function finish() {
      const g = gesture.current;
      gesture.current = null;
      globalThis.clearTimeout(g?.timer);
      globalThis.removeEventListener("pointermove", onMove);
      globalThis.removeEventListener("pointerup", onUp);
      globalThis.removeEventListener("pointercancel", onCancel);
      globalThis.removeEventListener("touchmove", onTouchMove);
      return g;
    }
    function onTouchMove(e: TouchEvent) { if (gesture.current?.active) e.preventDefault(); } // no scrolling while an event is carried
    function onMove(e: PointerEvent) {
      const g = gesture.current;
      if (!g || e.pointerId !== g.pointerId) return;
      const moved = Math.hypot(e.clientX - g.startX, e.clientY - g.startY);
      if (!g.active) {
        if (g.touch) { if (moved > 8) finish(); return; } // a swipe before the press: it was scrolling
        if (moved < 4) return;
        g.active = true;
      }
      const at = pointAt(e.clientX, e.clientY, g.original.date);
      g.latest = g.mode === "move" ? moveSlot(g.original, at.minutes - g.grabMin, at.date) : resizeSlot(g.original, at.minutes - g.grabMin);
      setDrag({ key: g.key, mode: g.mode, slot: g.latest });
    }
    function onUp(e: PointerEvent) {
      const g = gesture.current;
      if (!g || e.pointerId !== g.pointerId) return;
      finish();
      setDrag(null);
      if (g.active) {
        suppressClick.current = true; // the click that follows a drop is not a tap on the event
        globalThis.setTimeout(() => { suppressClick.current = false; }, 100);
        if (!sameSlot(g.latest, g.original)) {
          live.current.onMoveEvent?.(g.item, { date: g.latest.date, start: timeOfMinutes(g.latest.startMin), end: timeOfMinutes(g.latest.endMin) });
        }
      }
    }
    function onCancel(e: PointerEvent) {
      if (gesture.current && e.pointerId === gesture.current.pointerId) { finish(); setDrag(null); }
    }
    function begin(e: ReactPointerEvent, item: Occurrence, key: string, mode: "move" | "resize", original: Slot) {
      if (!live.current.onMoveEvent || e.button !== 0 || gesture.current) return;
      const touch = e.pointerType === "touch";
      const grab = pointAt(e.clientX, e.clientY, original.date);
      const g: Gesture = { item, key, mode, original, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, grabMin: grab.minutes, active: false, touch, latest: original };
      if (touch) {
        g.timer = globalThis.setTimeout(() => {
          if (gesture.current === g) { g.active = true; navigator.vibrate?.(10); setDrag({ key, mode, slot: original }); }
        }, LONG_PRESS_MS);
      }
      gesture.current = g;
      globalThis.addEventListener("pointermove", onMove);
      globalThis.addEventListener("pointerup", onUp);
      globalThis.addEventListener("pointercancel", onCancel);
      globalThis.addEventListener("touchmove", onTouchMove, { passive: false });
    }

    return { begin, finish };
  }, []);
  const { begin } = dnd;
  useEffect(() => () => { dnd.finish(); }, [dnd]);

  function createAt(date: string, e: MouseEvent<HTMLDivElement>) {
    if (!onCreateAt || e.target !== e.currentTarget || suppressClick.current) return; // (a drop can end over an empty spot)
    const rect = e.currentTarget.getBoundingClientRect();
    const minutes = minutesAt(bands, rect.height ? (e.clientY - rect.top) / rect.height : 0);
    onCreateAt(date, Math.min(23 * 60 + 30, Math.round(minutes / 30) * 30));
  }

  return (
    <div className="grid" ref={scroller} style={{ "--cols": days.length, "--grid-h": `${height}px`, ...(fit.room ? { maxHeight: Math.max(384, fit.room) } : {}) } as CSSProperties}>
      <div className="grid__corner" />
      {days.map((d) => (
        <div key={d} role="columnheader" className={`grid__dayhead ${d === today ? "grid__dayhead--today" : ""}`} data-date={d} aria-current={d === today ? "date" : undefined}>
          <small>{weekday.format(new Date(`${d}T12:00:00`))}</small>
          <b>{Number(d.slice(8))}</b>
        </div>
      ))}

      <div className="grid__alldaylabel">{t("schAllDay")}</div>
      {days.map((d) => (
        <div key={d} className={`grid__allday ${isWeekend(d) ? "grid__allday--weekend" : ""}`} data-date={d}>
          {byDay(d).filter((i) => i.all_day).map((i) => (
            <ScheduleChip key={keyOf(i)} item={i} onOpen={(x) => onOpenItem?.(x)} />
          ))}
          {tasks?.on(d).map((task) => <TaskChip key={`task-${task.id}`} task={task} layer={tasks} />)}
        </div>
      ))}

      <div className="grid__rail" style={{ height }}>
        {hours.map((h) => (
          <span key={h} className="grid__hour" style={{ top: `${positionOf(bands, h * 60) * 100}%` }}>{hourLabel(h)}</span>
        ))}
      </div>

      {days.map((d) => {
        const own = windowFor(d);
        const placed = layoutColumn<Entry>(
          byDay(d).filter((i) => !i.all_day && i.start_time).map((i) => {
            const start = toMinutes(i.start_time!);
            const end = i.end_time ? toMinutes(i.end_time) : start + 60;
            return { key: keyOf(i), startMin: start, endMin: Math.max(end, start + 15), item: i };
          }),
        );
        return (
          <div
            key={d}
            data-date={d}
            onClick={(e) => createAt(d, e)}
            ref={(el) => { if (el) columns.current.set(d, el); else columns.current.delete(d); }}
            className={`grid__col ${isWeekend(d) ? "grid__col--weekend" : ""} ${d === today ? "grid__col--today" : ""}`}
            style={{ height }}
          >
            {hours.map((h) => <i key={h} className="grid__line" style={{ top: `${positionOf(bands, h * 60) * 100}%` }} />)}
            {own.start > 0 && <div className="grid__off" style={{ top: 0, height: `${positionOf(bands, own.start * 60) * 100}%` }} />}
            {own.end < 24 && <div className="grid__off" style={{ top: `${positionOf(bands, own.end * 60) * 100}%`, bottom: 0 }} />}
            {placed.map(({ item: { item, startMin, endMin }, col, cols }) => {
              const top = positionOf(bands, startMin);
              const key = keyOf(item);
              const original: Slot = { date: d, startMin, endMin };
              const movable = !!onMoveEvent && (canMove?.(item) ?? true);
              return (
                <button
                  key={key}
                  type="button"
                  className={`grid__event ${movable ? "grid__event--movable" : ""} ${drag?.key === key ? "grid__event--dragging" : ""}`}
                  aria-label={`${item.title}, ${item.start_time}`}
                  onPointerDown={(e) => { if (movable) begin(e, item, key, "move", original); }}
                  style={{
                    top: `${top * 100}%`,
                    height: `${(positionOf(bands, endMin) - top) * 100}%`,
                    left: `${(col / cols) * 100}%`,
                    width: `calc(${100 / cols}% - 2px)`,
                    "--ev": eventColorVar(item.color),
                  } as CSSProperties}
                  onClick={() => { if (!suppressClick.current) onOpenItem?.(item); }}
                >
                  <span className="grid__event-title">{item.icon && <span aria-hidden="true">{item.icon} </span>}{item.title}</span>
                  <span className="grid__event-time">{item.start_time}</span>
                  {movable && <span className="grid__resize" aria-hidden="true" onPointerDown={(e) => { e.stopPropagation(); begin(e, item, key, "resize", original); }} />}
                </button>
              );
            })}
            {drag && drag.slot.date === d && (() => {
              const moving = items.find((i) => keyOf(i) === drag.key);
              const top = positionOf(bands, drag.slot.startMin);
              return (
                <div
                  className="grid__event grid__event--ghost"
                  aria-hidden="true"
                  style={{ top: `${top * 100}%`, height: `${(positionOf(bands, drag.slot.endMin) - top) * 100}%`, left: 0, width: "calc(100% - 2px)", "--ev": moving ? eventColorVar(moving.color) : "var(--accent)" } as CSSProperties}
                >
                  <span className="grid__event-title">{moving?.icon && <span>{moving.icon} </span>}{moving?.title}</span>
                  <span className="grid__event-time">{timeOfMinutes(drag.slot.startMin)}–{timeOfMinutes(drag.slot.endMin)}</span>
                </div>
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}
