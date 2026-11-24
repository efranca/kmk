import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import { eventColorVar } from "../ui/memberColor";
import { busyHours, hourBands, layoutColumn, minutesAt, positionOf, toMinutes, unionWindow, windowFor, type GridItem } from "./gridLayout";
import { isWeekend } from "./scheduleDates";
import { ScheduleChip } from "./ScheduleChip";
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
}

/**
 * Hours down the side, one column per day, events as blocks at their time. The whole day is there: the grid opens on
 * the working hours and the hours before and after are a scroll away (shaded). Hours with nothing in them on any day
 * shown are compacted, which leaves the room to the hours in use. All-day events sit in a strip on top, which stays in
 * view while the hours scroll. Weekend columns are tinted.
 */
export function TimeGrid({ days, items, today, locale, onOpenItem, onCreateAt }: TimeGridProps) {
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

  function createAt(date: string, e: MouseEvent<HTMLDivElement>) {
    if (!onCreateAt || e.target !== e.currentTarget) return;
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
            className={`grid__col ${isWeekend(d) ? "grid__col--weekend" : ""} ${d === today ? "grid__col--today" : ""}`}
            style={{ height }}
          >
            {hours.map((h) => <i key={h} className="grid__line" style={{ top: `${positionOf(bands, h * 60) * 100}%` }} />)}
            {own.start > 0 && <div className="grid__off" style={{ top: 0, height: `${positionOf(bands, own.start * 60) * 100}%` }} />}
            {own.end < 24 && <div className="grid__off" style={{ top: `${positionOf(bands, own.end * 60) * 100}%`, bottom: 0 }} />}
            {placed.map(({ item: { item, startMin, endMin }, col, cols }) => {
              const top = positionOf(bands, startMin);
              return (
                <button
                  key={keyOf(item)}
                  type="button"
                  className="grid__event"
                  aria-label={`${item.title}, ${item.start_time}`}
                  style={{
                    top: `${top * 100}%`,
                    height: `${(positionOf(bands, endMin) - top) * 100}%`,
                    left: `${(col / cols) * 100}%`,
                    width: `calc(${100 / cols}% - 2px)`,
                    "--ev": eventColorVar(item.color),
                  } as CSSProperties}
                  onClick={() => onOpenItem?.(item)}
                >
                  <span className="grid__event-title">{item.icon && <span aria-hidden="true">{item.icon} </span>}{item.title}</span>
                  <span className="grid__event-time">{item.start_time}</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
