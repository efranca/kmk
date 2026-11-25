import type { ReactNode } from "react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { EmptyArt, type ArtName } from "../ui/EmptyArt";
import { EmptyState } from "../ui/Feedback";

/** "Today" for today, otherwise the weekday and day number ("Wed 25"). */
export function dayLabelFor(date: string, today: string, locale: string, todayWord: string): string {
  if (date === today) return todayWord;
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric" }).format(new Date(`${date}T12:00:00`));
}

/** A dashboard widget: a titled card whose title opens the schedule. `state` (loading or an error) replaces the content. */
export function DashCard({
  title,
  onOpen,
  href = "/schedule",
  state,
  empty,
  emptyText,
  art,
  emptyHint,
  children,
}: {
  title: string;
  /** What the title opens: the schedule unless told otherwise. */
  onOpen: () => void;
  href?: string;
  state: ReactNode | null;
  empty: boolean;
  emptyText?: string;
  /** A picture and a friendly line for the empty card. */
  art?: ArtName;
  emptyHint?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <section className="dcard" aria-labelledby={id}>
      <header className="dcard__header">
        <h2 id={id}>
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              onOpen();
            }}
          >
            {title}
          </a>
        </h2>
      </header>
      {state ?? (empty ? (art ? <EmptyArt compact art={art} title={emptyText ?? t("dashEmpty")} hint={emptyHint} /> : <EmptyState>{emptyText ?? t("dashEmpty")}</EmptyState>) : children)}
    </section>
  );
}
