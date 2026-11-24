import { useTranslation } from "react-i18next";

import { Button, IconButton } from "../ui/Button";
import { MAX_REMINDERS } from "./eventForm";
import type { ReminderIn, ReminderUnit } from "./types";

const UNITS: readonly ReminderUnit[] = ["hours", "days", "weeks"];
const unitKey = (u: ReminderUnit) => `schUnits${u[0]!.toUpperCase()}${u.slice(1)}`;

/** The first reminder not already in the list, so a new row never starts as a duplicate. */
function nextReminder(existing: ReminderIn[]): ReminderIn {
  for (let amount = 1; amount <= 99; amount++) {
    for (const unit of ["days", "hours", "weeks"] as const) {
      if (!existing.some((r) => r.amount === amount && r.unit === unit)) return { amount, unit };
    }
  }
  return { amount: 1, unit: "days" };
}

interface ReminderFieldsProps {
  values: ReminderIn[];
  error?: string;
  onChange: (values: ReminderIn[]) => void;
}

/** Up to ten reminders, each "N hours, days or weeks before" the start. They show in the app while someone is signed in. */
export function ReminderFields({ values, error, onChange }: ReminderFieldsProps) {
  const { t } = useTranslation();
  const set = (i: number, change: Partial<ReminderIn>) => onChange(values.map((r, k) => (k === i ? { ...r, ...change } : r)));
  return (
    <fieldset className="field sched-reminders">
      <legend className="field__label">{t("schFormReminders")}</legend>
      <p className="field__hint">{t("schFormRemindersHint", { max: MAX_REMINDERS })}</p>
      {values.map((r, i) => (
        <div key={i} className="sched-reminders__row">
          <input type="number" className="input" min={1} max={99} value={r.amount || ""} aria-label={t("schFormReminderAmount", { n: i + 1 })} onChange={(e) => set(i, { amount: Number(e.target.value) || 0 })} />
          <select className="input" value={r.unit} aria-label={t("schFormReminderUnit", { n: i + 1 })} onChange={(e) => set(i, { unit: e.target.value as ReminderUnit })}>
            {UNITS.map((u) => <option key={u} value={u}>{t(unitKey(u))}</option>)}
          </select>
          <span className="sched-reminders__before">{t("schFormBefore")}</span>
          <IconButton icon="x" label={t("schFormRemoveReminder", { n: i + 1 })} onClick={() => onChange(values.filter((_, k) => k !== i))} />
        </div>
      ))}
      {error && <p className="field__error" role="alert">{error}</p>}
      <Button variant="ghost" icon="plus" disabled={values.length >= MAX_REMINDERS} onClick={() => onChange([...values, nextReminder(values)])}>{t("schFormAddReminder")}</Button>
    </fieldset>
  );
}
