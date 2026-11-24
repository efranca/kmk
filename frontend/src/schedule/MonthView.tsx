import { useTranslation } from "react-i18next";

import { isWeekend, monthGrid } from "./scheduleDates";
import { ScheduleChip } from "./ScheduleChip";
import type { Occurrence } from "./types";

const MAX_CHIPS = 3;

interface MonthViewProps {
  year: number;
  /** 1 to 12. */
  month: number;
  items: Occurrence[];
  today: string;
  firstDay: 0 | 1;
  locale: string;
  onOpenDay: (date: string) => void;
  onOpenItem: (item: Occurrence) => void;
}

/** A classic month: six weeks of days, each with up to three short chips and "+N more"; a day opens its Day view. */
export function MonthView({ year, month, items, today, firstDay, locale, onOpenDay, onOpenItem }: MonthViewProps) {
  const { t } = useTranslation();
  const days = monthGrid(year, month, firstDay);
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short" });
  const dayName = new Intl.DateTimeFormat(locale, { month: "long", day: "numeric" });
  const at = (d: string) => new Date(`${d}T12:00:00`);

  return (
    <div className="month">
      <div className="month__head">
        {days.slice(0, 7).map((d) => (
          <div key={d} role="columnheader" className="month__weekday">{weekday.format(at(d))}</div>
        ))}
      </div>
      <div className="month__grid">
        {days.map((d) => {
          const here = items.filter((i) => i.date === d);
          const classes = [
            "month__day",
            d.startsWith(prefix) ? "" : "month__day--outside",
            d === today ? "month__day--today" : "",
            isWeekend(d) ? "month__day--weekend" : "",
          ].filter(Boolean).join(" ");
          return (
            <div key={d} className={classes} data-date={d}>
              <button type="button" className="month__num" aria-label={dayName.format(at(d))} onClick={() => onOpenDay(d)}>
                {Number(d.slice(8))}
              </button>
              {here.slice(0, MAX_CHIPS).map((i) => (
                <ScheduleChip key={`${i.event_id}-${i.original_date}`} item={i} onOpen={onOpenItem} />
              ))}
              {here.length > MAX_CHIPS && (
                <button type="button" className="month__more" onClick={() => onOpenDay(d)}>
                  {t("schMore", { n: here.length - MAX_CHIPS })}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
