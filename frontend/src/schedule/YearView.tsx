import { isWeekend, monthGrid } from "./scheduleDates";

interface YearViewProps {
  year: number;
  /** The days that have anything on them. */
  busyDates: ReadonlySet<string>;
  today: string;
  firstDay: 0 | 1;
  locale: string;
  /** A month was clicked: the first day of that month. */
  onOpenMonth: (firstOfMonth: string) => void;
}

/** All twelve months at once, without details: days that have anything on them carry a dot. */
export function YearView({ year, busyDates, today, firstDay, locale, onOpenMonth }: YearViewProps) {
  const monthName = new Intl.DateTimeFormat(locale, { month: "long" });
  const letter = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
  const at = (d: string) => new Date(`${d}T12:00:00`);

  return (
    <div className="year">
      {Array.from({ length: 12 }, (_, m) => m + 1).map((month) => {
        const prefix = `${year}-${String(month).padStart(2, "0")}`;
        const days = monthGrid(year, month, firstDay);
        return (
          <section key={month} className="year__month">
            <button type="button" className="year__title" onClick={() => onOpenMonth(`${prefix}-01`)}>
              {monthName.format(at(`${prefix}-01`))}
            </button>
            <div className="year__grid">
              {days.slice(0, 7).map((d) => (
                <span key={d} className="year__weekday" aria-hidden="true">{letter.format(at(d))}</span>
              ))}
              {days.map((d) =>
                d.startsWith(prefix) ? (
                  <span key={d} data-date={d} className={`year__day ${d === today ? "year__day--today" : ""} ${isWeekend(d) ? "year__day--weekend" : ""}`}>
                    {Number(d.slice(8))}
                    {busyDates.has(d) && <i className="year__dot" aria-hidden="true" />}
                  </span>
                ) : (
                  <span key={d} />
                ),
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
