import { useTranslation } from "react-i18next";

import { IconButton } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { useDismissReminder, useDueReminders } from "./hooks";

/**
 * Reminders that are due for the signed-in person, shown on every page until dismissed: an event's title and when it
 * takes place. Nothing renders when nothing is due, or when the poll fails. (On screen only: there is no email or push.)
 */
export function ReminderTray() {
  const { t, i18n } = useTranslation();
  const reminders = useDueReminders();
  const dismiss = useDismissReminder();
  if (!reminders.data || reminders.data.length === 0) return null;
  const day = new Intl.DateTimeFormat(i18n.language, { weekday: "short", month: "short", day: "numeric" });
  return (
    <aside className="reminders" aria-label={t("schReminderLabel")} aria-live="polite">
      {reminders.data.map((r) => (
        <div key={`${r.event_id}-${r.occurrence_date}`} className="reminder">
          <span className="reminder__icon" aria-hidden="true"><Icon name="bell" size={20} /></span>
          <div className="reminder__text">
            <b>{r.title}</b>
            <span>{day.format(new Date(`${r.start_date}T12:00:00`))} · {r.all_day ? t("schAllDay") : r.start_time}</span>
          </div>
          <IconButton icon="x" label={t("schReminderDismiss", { title: r.title })} onClick={() => dismiss.mutate({ eventId: r.event_id, occurrenceDate: r.occurrence_date })} />
        </div>
      ))}
    </aside>
  );
}
