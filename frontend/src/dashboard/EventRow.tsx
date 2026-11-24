import { useTranslation } from "react-i18next";

import type { Occurrence } from "../schedule/types";
import type { Person } from "../ui/Avatar";
import { AvatarGroup } from "../ui/AvatarGroup";

/** One event of the dashboard: when, what, and who it is for. Tapping it opens that day in the schedule. */
export function EventRow({
  item,
  people,
  dayLabel,
  showFaces = true,
  onOpen,
}: {
  item: Occurrence;
  people: ReadonlyMap<number, Person>;
  /** The day it takes place ("Today", "Wed 25"), when the list spans several days. */
  dayLabel?: string;
  showFaces?: boolean;
  onOpen: (item: Occurrence) => void;
}) {
  const { t } = useTranslation();
  const who = item.people.map((id) => people.get(id)).filter((p) => p !== undefined);
  return (
    <li>
      <button type="button" className="dash__row" onClick={() => onOpen(item)} style={{ "--ev": `var(--ev-${item.color})` } as React.CSSProperties}>
        <span className="dash__when">
          {dayLabel && <small>{dayLabel}</small>}
          <b>{item.all_day ? t("schAllDay") : item.start_time}</b>
        </span>
        <span className="dash__title">{item.icon && <span aria-hidden="true">{item.icon} </span>}{item.title}</span>
        {showFaces && <span className="dash__who"><AvatarGroup people={who} everyone={item.people.length === 0} max={3} mutedIds={new Set(who.filter((p) => p.active === false).map((p) => p.id))} /></span>}
      </button>
    </li>
  );
}
