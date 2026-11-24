import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Button, IconButton } from "../ui/Button";
import { ChoiceChip, ChoiceChips } from "../ui/ChoiceChips";
import { everyWeekday, formToRule, isEveryWeekday, monthDaySkipsMonths, repeatDefaultsFor, type EventFormErrors, type EventFormValues, type RepeatForm } from "./eventForm";
import { describeRepeat, WEEKDAY_CODES, weekdayName } from "./scheduleDates";
import type { WeekdayCode } from "./types";

/** What the repeat list offers: the form's modes, plus the "weekday" preset (a weekly rule on Monday to Friday). */
type RepeatChoice = RepeatForm["mode"] | "weekday";
const CHOICES: readonly RepeatChoice[] = ["none", "daily", "weekday", "weekly", "monthly", "yearly"];
const EVERY_UNIT: Record<Exclude<RepeatForm["mode"], "none">, string> =
  { daily: "schEveryUnitDays", weekly: "schEveryUnitWeeks", monthly: "schEveryUnitMonths", yearly: "schEveryUnitYears" };
const cap = (word: string) => word[0]!.toUpperCase() + word.slice(1);

interface RecurrenceFieldsProps {
  values: EventFormValues;
  errors: EventFormErrors;
  locale: string;
  onChange: (repeat: RepeatForm) => void;
}

/** How the event repeats, as in Google Calendar: every N days/weeks/months/years, weekdays, "the 4th Saturday", and when it ends. */
export function RecurrenceFields({ values, errors, locale, onChange }: RecurrenceFieldsProps) {
  const { t } = useTranslation();
  const group = useId();
  const r = values.repeat;
  const set = (change: Partial<RepeatForm>) => onChange({ ...r, ...change });
  const rule = formToRule(r);
  const describable = rule !== null && (rule.freq !== "weekly" || rule.weekdays.length > 0)
    && (rule.freq !== "monthly" || rule.month_day != null || rule.nth_weekdays.length > 0);
  const toggleDay = (code: WeekdayCode) =>
    set({ weekdays: r.weekdays.includes(code) ? r.weekdays.filter((d) => d !== code) : [...r.weekdays, code] });
  const setNth = (i: number, change: Partial<RepeatForm["nth"][number]>) =>
    set({ nth: r.nth.map((n, k) => (k === i ? { ...n, ...change } : n)) });
  const err = (key: keyof EventFormErrors) => errors[key] && <p className="field__error" role="alert">{t(errors[key])}</p>;

  return (
    <div className="sched-repeat">
      <div className="field">
        <label className="field__label" htmlFor={`${group}-mode`}>{t("schFormRepeat")}</label>
        <select id={`${group}-mode`} className="input" value={isEveryWeekday(r) ? "weekday" : r.mode}
          onChange={(e) => {
            const choice = e.target.value as RepeatChoice;
            onChange(choice === "weekday" ? everyWeekday(r) : repeatDefaultsFor(choice, values.date, r));
          }}>
          {CHOICES.map((m) => <option key={m} value={m}>{t(`schRepeatModes${cap(m)}`)}</option>)}
        </select>
      </div>

      {r.mode !== "none" && (
        <>
          <div className="sched-repeat__every">
            <label htmlFor={`${group}-every`}>{t("schFormEvery")}</label>
            <input id={`${group}-every`} type="number" className="input" min={1} max={99} value={r.interval || ""}
              onChange={(e) => set({ interval: Number(e.target.value) || 0 })} />
            <span>{t(EVERY_UNIT[r.mode])}</span>
          </div>

          {r.mode === "weekly" && (
            <div className="field">
              <ChoiceChips label={t("schFormWeekdays")}>
                {WEEKDAY_CODES.map((code) => (
                  <ChoiceChip key={code} pressed={r.weekdays.includes(code)} onClick={() => toggleDay(code)}>{weekdayName(code, locale, "short")}</ChoiceChip>
                ))}
              </ChoiceChips>
              {err("weekdays")}
            </div>
          )}

          {r.mode === "monthly" && (
            <div className="field" role="group" aria-label={t("schFormMonthlyBy")}>
              <label className="check">
                <input type="radio" name={`${group}-by`} checked={r.monthlyBy === "day"} onChange={() => set({ monthlyBy: "day" })} />
                {t("schFormOnDay")}
              </label>
              <label className="check">
                <input type="radio" name={`${group}-by`} checked={r.monthlyBy === "nth"} onChange={() => set({ monthlyBy: "nth" })} />
                {t("schFormOnNthWeekday")}
              </label>
              {r.monthlyBy === "day" ? (
                <>
                  <input type="number" className="input" min={1} max={31} value={r.monthDay || ""}
                    aria-label={t("schFormDayOfMonth")} onChange={(e) => set({ monthDay: Number(e.target.value) || 0 })} />
                  {err("monthDay")}
                  {monthDaySkipsMonths(values) && <p className="field__hint">{t("schFormSkipWarning")}</p>}
                </>
              ) : (
                <>
                  {r.nth.map((n, i) => (
                    <div key={i} className="sched-repeat__nth">
                      <select className="input" value={n.nth} aria-label={t("schFormWhich", { n: i + 1 })}
                        onChange={(e) => setNth(i, { nth: Number(e.target.value) })}>
                        {[1, 2, 3, 4, 5].map((k) => <option key={k} value={k}>{t(`schRepeatNth${k}`)}</option>)}
                      </select>
                      <select className="input" value={n.day} aria-label={t("schFormWeekdayN", { n: i + 1 })}
                        onChange={(e) => setNth(i, { day: e.target.value as WeekdayCode })}>
                        {WEEKDAY_CODES.map((code) => <option key={code} value={code}>{weekdayName(code, locale)}</option>)}
                      </select>
                      <IconButton icon="x" label={t("schFormRemoveWeekday", { n: i + 1 })}
                        onClick={() => set({ nth: r.nth.filter((_, k) => k !== i) })} />
                    </div>
                  ))}
                  {err("nth")}
                  <Button variant="ghost" icon="plus" disabled={r.nth.length >= 5}
                    onClick={() => set({ nth: [...r.nth, { nth: 1, day: r.nth[0]?.day ?? "MON" }] })}>{t("schFormAddWeekday")}</Button>
                </>
              )}
            </div>
          )}

          {describable && <p className="sched-repeat__summary">{describeRepeat(rule, t, locale)}</p>}

          <div className="field" role="group" aria-label={t("schFormEnds")}>
            <span className="field__label">{t("schFormEnds")}</span>
            <label className="check">
              <input type="radio" name={`${group}-end`} checked={r.end === "never"} onChange={() => set({ end: "never" })} />
              {t("schFormEndNever")}
            </label>
            <label className="check">
              <input type="radio" name={`${group}-end`} checked={r.end === "on"} onChange={() => set({ end: "on", endsOn: r.endsOn || values.date })} />
              {t("schFormEndOn")}
            </label>
            {r.end === "on" && (
              <input type="date" className="input" value={r.endsOn} aria-label={t("schFormEndDate")}
                onChange={(e) => set({ endsOn: e.target.value })} />
            )}
            {err("endsOn")}
            <label className="check">
              <input type="radio" name={`${group}-end`} checked={r.end === "after"} onChange={() => set({ end: "after" })} />
              {t("schFormEndAfter")}
            </label>
            {r.end === "after" && (
              <input type="number" className="input" min={1} value={r.count || ""} aria-label={t("schFormCount")}
                onChange={(e) => set({ count: Number(e.target.value) || 0 })} />
            )}
            {err("count")}
          </div>
        </>
      )}
    </div>
  );
}
