import type { ReactNode } from "react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { EmptyState } from "../ui/Feedback";

/** "Today" for today, otherwise the weekday and day number ("Wed 25"). */
export function dayLabelFor(date: string, today: string, locale: string, todayWord: string): string {
  if (date === today) return todayWord;
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric" }).format(new Date(`${date}T12:00:00`));
}

/** A dashboard widget: a titled card whose title opens the schedule. `state` (loading or an error) replaces the content. */
export function DashCard({
  title,
  onOpenSchedule,
  state,
  empty,
  children,
}: {
  title: string;
  onOpenSchedule: () => void;
  state: ReactNode | null;
  empty: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <section className="dcard" aria-labelledby={id}>
      <header className="dcard__header">
        <h2 id={id}>
          <a
            href="/schedule"
            onClick={(e) => {
              e.preventDefault();
              onOpenSchedule();
            }}
          >
            {title}
          </a>
        </h2>
      </header>
      {state ?? (empty ? <EmptyState>{t("dashEmpty")}</EmptyState> : children)}
    </section>
  );
}
